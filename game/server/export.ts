import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { uploadStore } from './bootstrap';
import {
  CallbackFn,
  CaptureOptions,
  DataType,
  ScreenshotBasicCallbackFn,
  StreamRemoteConfig,
  createScreenshotBasicUploadData,
  createRegularUploadData,
} from './types';
import { exportHandler } from './utils';

// Temp directory for in-progress video recordings, one .webm file per active stream.
const tempDir = path.join(GetResourcePath(GetCurrentResourceName()), 'tmp');
mkdir(tempDir, { recursive: true }).catch((err) => {
  console.error('[screencapture] Failed to create temp directory:', err);
});

// Start a video recording for a specific player source.
// The callback receives the assembled WebM file path once the recording is stopped.
global.exports('serverCaptureStream', (source: number, options: CaptureOptions, callback: CallbackFn) => {
  if (!source) return console.error('[screencapture] source is required for serverCaptureStream');

  const token = uploadStore.addStream({
    source,
    tempDir,
    callback: callback ?? (() => {}),
  });

  emitNet('screencapture:captureStream', source, token, options ?? {});
});

// Record a video and upload it to a remote URL once stopped.
// The callback receives the remote API's JSON response.
global.exports(
  'remoteUploadStream',
  (
    source: number,
    url: string,
    options: StreamRemoteConfig & Pick<CaptureOptions, 'maxWidth' | 'maxHeight'>,
    callback: CallbackFn,
  ) => {
    if (!source) return console.error('[screencapture] source is required for remoteUploadStream');
    if (!url) return console.error('[screencapture] url is required for remoteUploadStream');

    const token = uploadStore.addStream({
      source,
      tempDir,
      callback: callback ?? (() => {}),
      isRemote: true,
      remoteUrl: url,
      remoteConfig: {
        headers: options?.headers,
        formField: options?.formField,
        filename: options?.filename,
      },
    });

    emitNet('screencapture:captureStream', source, token, options ?? {});
  },
);

// Stop the active recording for a specific player source.
// The NUI will call output.finalize() which triggers the /stream-finalize
// endpoint, assembles the file, and fires the callback.
global.exports('INTERNAL_stopServerCaptureStream', (source: number) => {
  emitNet('screencapture:INTERNAL:stopCaptureStream', source);
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
