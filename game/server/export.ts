import { uploadStore } from './bootstrap';
import { CallbackFn, CaptureOptions, DataType, ScreenshotBasicCallbackFn, createScreenshotBasicUploadData, createRegularUploadData } from './types';
import { exportHandler } from './utils';

global.exports("serverCaptureStream", (source: number) => {
  const token = uploadStore.addStream({
    callback: null,
    isRemote: false,
    remoteConfig: null,
  })

  emitNet("screencapture:captureStream", source, token, {})
})

// DO NOT USE
global.exports("INTERNAL_stopServerCaptureStream", (source: number) => {
  emitNet("screencapture:INTERNAL:stopCaptureStream", source)
})

// upload the file from the server and return the raw response
global.exports(
  'remoteUpload',
  (source: number, url: string, options: CaptureOptions, callback: CallbackFn, dataType: DataType = 'base64') => {
    if (!source) return console.error('source is required for serverCapture');

    const token = uploadStore.addUpload(createRegularUploadData({
      callback: callback,
      isRemote: true,
      remoteConfig: {
        ...options,
        encoding: options.encoding ?? 'webp',
      },
      url,
      dataType,
    }));

    emitNet('screencapture:captureScreen', source, token, options, dataType);
  },
);

// dataType here doesn't matter for NUI, its just for the server to know how to handle the data
// when calling this export, the client will always send it back as base64
global.exports(
  'serverCapture',
  (source: number, options: CaptureOptions, callback: CallbackFn, dataType: DataType = 'base64') => {
    if (!source) return console.error('source is required for serverCapture');

    const opts = {
      ...options,
      encoding: options.encoding ?? 'webp',
    };

    const token = uploadStore.addUpload(createRegularUploadData({
      callback,
      isRemote: false,
      remoteConfig: opts,
      dataType,
    }));

    emitNet('screencapture:captureScreen', source, token, opts, dataType);
  },
);

// screeenshot-basic backwards compatibility
function requestClientScreenshot(source: number, options: CaptureOptions, callback: ScreenshotBasicCallbackFn) {
  if (!source) return console.error('source is required for requestClientScreenshot');

  const opts = {
    ...options,
    encoding: options.encoding ?? 'webp',
  };

  const isBlob = options.fileName ? true : false;

  const token = uploadStore.addUpload(createScreenshotBasicUploadData({
    callback,
    isRemote: false,
    remoteConfig: opts,
    dataType: isBlob ? 'blob' : 'base64',
  }));

  emitNet('screencapture:captureScreen', source, token, opts, isBlob ? 'blob' : 'base64');
}

global.exports(
  'requestClientScreenshot',
  (source: number, options: CaptureOptions, callback: ScreenshotBasicCallbackFn) => {
    requestClientScreenshot(source, options, callback);
  },
);
exportHandler("requestClientScreenshot", (source: number, options: CaptureOptions, callback: ScreenshotBasicCallbackFn) => {
  requestClientScreenshot(source, options, callback);
});