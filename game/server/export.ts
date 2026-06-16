import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { uploadStore } from './bootstrap';
import {
  CallbackFn,
  CaptureOptions,
  DataType,
  ScreenshotBasicCallbackFn,
  StreamRemoteConfig,
  StreamSegmentFn,
  createScreenshotBasicUploadData,
  createRegularUploadData,
} from './types';
import { exportHandler } from './utils';
import { nanoid } from 'nanoid';


const tempDir = path.join(GetResourcePath(GetCurrentResourceName()), 'tmp');
mkdir(tempDir, { recursive: true }).catch((err) => {
  console.error('[screencapture] Failed to create temp directory:', err);
});

function normalizeStreamOptions(options: CaptureOptions = {}, duration?: number): CaptureOptions {
  return {
    ...options,
    ...(duration !== undefined && options.duration === undefined && { duration }),
  };
}

function validateStreamRequest(source: number, options: CaptureOptions, exportName: string): boolean {
  if (!source) {
    console.error(`[screencapture] source is required for ${exportName}`);
    return false;
  }

  if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration <= 0)) {
    console.error(`[screencapture] duration must be a positive number for ${exportName}`);
    return false;
  }

  if (uploadStore.hasActiveStreamForSource(source)) {
    console.error(`[screencapture] source ${source} already has an active video capture`);
    return false;
  }

  return true;
}

function startVideoCapture(
  source: number,
  options: CaptureOptions = {},
  callback: CallbackFn = () => {},
  legacyCallback = false,
): string | undefined {
  if (!validateStreamRequest(source, options, legacyCallback ? 'serverCaptureStream' : 'startVideoCapture')) return;

  const captureId = nanoid(24);
  console.log(`[screencapture] Starting video capture for source ${source} with capture ID ${captureId}`);

  const token = uploadStore.addStream({
    captureId,
    source,
    tempDir,
    callback,
    duration: options.duration,
    legacyCallback,
  });

  emitNet('screencapture:captureStream', source, token, options, captureId);

  return captureId;
}

function startVideoCaptureUpload(
  source: number,
  url: string,
  options: StreamRemoteConfig & Pick<CaptureOptions, 'maxWidth' | 'maxHeight' | 'duration'> = {},
  callback: CallbackFn = () => {},
  legacyCallback = false,
): string | undefined {
  if (!url) {
    console.error(`[screencapture] url is required for ${legacyCallback ? 'remoteUploadStream' : 'startVideoCaptureUpload'}`);
    return;
  }

  if (!validateStreamRequest(source, options, legacyCallback ? 'remoteUploadStream' : 'startVideoCaptureUpload')) return;

  const captureId = nanoid(24);
  console.log(`[screencapture] Starting remote video capture for source ${source} with capture ID ${captureId}`);

  const token = uploadStore.addStream({
    captureId,
    source,
    tempDir,
    callback,
    duration: options.duration,
    isRemote: true,
    remoteUrl: url,
    remoteConfig: {
      headers: options?.headers,
      formField: options?.formField,
      filename: options?.filename,
    },
    legacyCallback,
  });

  emitNet('screencapture:captureStream', source, token, options, captureId);

  return captureId;
}

// Live relay: starts a continuous capture and forwards MSE-appendable WebM segments
// (one 'init' + one 'media' per Cluster) to onSegment as they are produced. Nothing
// is written to disk. Use with MediaSource on the receiving end for gap-free playback.
// Stop with stopVideoCapture(captureId) (or pass options.duration). onSegment fires
// frequently — keep it cheap. options.streamChunkSize (bytes) trades latency vs.
// overhead (smaller = lower latency; default 800 KiB).
function startVideoStream(
  source: number,
  options: CaptureOptions = {},
  onSegment: StreamSegmentFn,
  callback: CallbackFn = () => {},
): string | undefined {
  if (typeof onSegment !== 'function') {
    console.error('[screencapture] onSegment callback is required for startVideoStream');
    return;
  }
  if (!validateStreamRequest(source, options, 'startVideoStream')) return;

  const captureId = nanoid(24);
  console.log(`[screencapture] Starting video stream for source ${source} with capture ID ${captureId}`);

  const token = uploadStore.addStream({
    captureId,
    source,
    tempDir,
    callback,
    duration: options.duration,
    relay: true,
    onSegment,
  });

  emitNet('screencapture:captureStream', source, token, options, captureId);

  return captureId;
}

global.exports('startVideoCapture', startVideoCapture);
global.exports('startVideoCaptureUpload', startVideoCaptureUpload);
global.exports('startVideoStream', startVideoStream);
global.exports('serverCaptureStream', (source: number, options: CaptureOptions, callback: CallbackFn, duration?: number) => {
  return startVideoCapture(source, normalizeStreamOptions(options ?? {}, duration), callback ?? (() => {}), true);
});


global.exports(
  'remoteUploadStream',
  (
    source: number,
    url: string,
    options: StreamRemoteConfig & Pick<CaptureOptions, 'maxWidth' | 'maxHeight'>,
    callback: CallbackFn,
    duration?: number,
  ) => {
    return startVideoCaptureUpload(source, url, normalizeStreamOptions(options ?? {}, duration), callback ?? (() => {}), true);
  },
);

global.exports('stopVideoCapture', (captureId: string) => {
  if (!captureId) return console.error('[screencapture] captureId is required for stopVideoCapture');

  try {
    const streamData = uploadStore.getStreamByCaptureId(captureId);
    emitNet('screencapture:INTERNAL:stopCaptureStream', streamData.source, captureId);
  } catch (err) {
    console.error('[screencapture] stopVideoCapture failed:', err);
  }
});

global.exports('isVideoCaptureActive', (captureId: string) => {
  if (!captureId) return false;

  try {
    uploadStore.getStreamByCaptureId(captureId);
    return true;
  } catch {
    return false;
  }
});

global.exports('INTERNAL_stopServerCaptureStream', (source: number) => {
  const captureId = uploadStore.getCaptureIdBySource(source);
  emitNet('screencapture:INTERNAL:stopCaptureStream', source, captureId);
});

global.exports('stopStream', (source: number) => {
  const captureId = uploadStore.getCaptureIdBySource(source);
  emitNet('screencapture:INTERNAL:stopCaptureStream', source, captureId);
});

global.exports(
  'remoteUpload',
  (source: number, url: string, options: CaptureOptions, callback: CallbackFn, dataType: DataType = 'base64') => {
    if (!source) return console.error('source is required for serverCapture');

    const token = uploadStore.addUpload(
      createRegularUploadData({
        callback: callback,
        isRemote: true,
        remoteConfig: {
          ...options,
          encoding: options.encoding ?? 'webp',
        },
        url,
        dataType,
      }),
    );

    emitNet('screencapture:captureScreen', source, token, options, dataType);
  },
);

global.exports(
  'serverCapture',
  (source: number, options: CaptureOptions, callback: CallbackFn, dataType: DataType = 'base64') => {
    if (!source) return console.error('source is required for serverCapture');

    const opts = {
      ...options,
      encoding: options.encoding ?? 'webp',
    };

    const token = uploadStore.addUpload(
      createRegularUploadData({
        callback,
        isRemote: false,
        remoteConfig: opts,
        dataType,
      }),
    );

    emitNet('screencapture:captureScreen', source, token, opts, dataType);
  },
);

// screenshot-basic backwards compatibility
function requestClientScreenshot(source: number, options: CaptureOptions, callback: ScreenshotBasicCallbackFn) {
  if (!source) return console.error('source is required for requestClientScreenshot');

  const opts = {
    ...options,
    encoding: options.encoding ?? 'webp',
  };

  const isBlob = options.fileName ? true : false;

  const token = uploadStore.addUpload(
    createScreenshotBasicUploadData({
      callback,
      isRemote: false,
      remoteConfig: opts,
      dataType: isBlob ? 'blob' : 'base64',
    }),
  );

  emitNet('screencapture:captureScreen', source, token, opts, isBlob ? 'blob' : 'base64');
}

global.exports(
  'requestClientScreenshot',
  (source: number, options: CaptureOptions, callback: ScreenshotBasicCallbackFn) => {
    requestClientScreenshot(source, options, callback);
  },
);
exportHandler(
  'requestClientScreenshot',
  (source: number, options: CaptureOptions, callback: ScreenshotBasicCallbackFn) => {
    requestClientScreenshot(source, options, callback);
  },
);
