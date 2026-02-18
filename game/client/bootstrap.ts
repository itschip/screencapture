import { request } from 'http';
import { netEventController } from './event';
import { CaptureRequest, RequestScreenshotUploadCB, ScreenshotCreatedBody } from './types';
import { exportHandler, uuidv4 } from './utils';

const clientCaptureMap = new Map<string, RequestScreenshotUploadCB>();

RegisterNuiCallbackType('screenshot_created');

onNet('screencapture:captureScreen', (token: string, options: object, dataType: string) => {
  SendNUIMessage({
    ...options,
    uploadToken: token,
    dataType,
    action: 'capture',
    serverEndpoint: `http://${GetCurrentServerEndpoint()}/${GetCurrentResourceName()}/image`,
  });
});

onNet('screencapture:INTERNAL_uploadComplete', (response: unknown, correlationId: string) => {
  const callback = clientCaptureMap.get(correlationId);
  if (callback) {
    callback(response);
    clientCaptureMap.delete(correlationId);
  }
});


// screenshot-basic compatibility
on('__cfx_nui:screenshot_created', (body: ScreenshotCreatedBody, cb: (arg: any) => void) => {
  cb(true);

  if (body.id !== undefined && clientCaptureMap.has(body.id)) {
    const callback = clientCaptureMap.get(body.id);
    if (callback) {
      callback(body.data);
      clientCaptureMap.delete(body.id);
    }
  }
});

async function requestScreenshotUpload(
  url: string,
  formField: string,
  optionsOrCB: CaptureRequest | RequestScreenshotUploadCB,
  callback: RequestScreenshotUploadCB,
) {
  // forgive me
  const isOptions = typeof optionsOrCB === 'object' && optionsOrCB !== null;
  const realOptions = isOptions
    ? (optionsOrCB as CaptureRequest)
    : ({ headers: {}, encoding: 'webp' } as CaptureRequest);
  const realCallback = isOptions
    ? (callback as RequestScreenshotUploadCB)
    : (optionsOrCB as RequestScreenshotUploadCB);

  const correlationId = uuidv4();
  clientCaptureMap.set(correlationId, realCallback);

  const token = await netEventController<string>('screencapture:INTERNAL_requestUploadToken', {
    ...realOptions,
    formField,
    url,
    correlationId,
  });

  if (!token) {
    return console.error('Failed to get upload token');
  }

  return createImageCaptureMessage({
    ...realOptions,
    formField,
    url,
    uploadToken: token,
    dataType: 'blob',
  });
}

exportHandler('requestScreenshotUpload', requestScreenshotUpload);
global.exports(
  'requestScreenshotUpload',
  async (
    url: string,
    formField: string,
    optionsOrCB: CaptureRequest | RequestScreenshotUploadCB,
    callback: RequestScreenshotUploadCB,
  ) => {
    return await requestScreenshotUpload(url, formField, optionsOrCB, callback);
  }
);

function requestScreenshot(options: CaptureRequest, callback: RequestScreenshotUploadCB) {
  const correlationId = uuidv4();

  const realOptions = (callback !== undefined) ? options : {
    encoding: 'jpg'
  } as CaptureRequest;

  // :)
  const realCb = (typeof callback === 'function') ? callback : (typeof options === 'function' ? options : undefined);
  if (typeof realCb !== 'function') {
    return console.error('Callback is not a function');
  }

  clientCaptureMap.set(correlationId, realCb);

  createImageCaptureMessage({
    ...realOptions,
    callbackUrl: `http://${GetCurrentResourceName()}/screenshot_created`,
    correlationId,
  });
}

exportHandler('requestScreenshot', requestScreenshot);
global.exports('requestScreenshot', (options: CaptureRequest, callback: RequestScreenshotUploadCB) => {
  return requestScreenshot(options, callback);
});

function createImageCaptureMessage(options: CaptureRequest) {
  SendNUIMessage({
    ...options,
    action: 'capture',
    serverEndpoint: `http://${GetCurrentServerEndpoint()}/${GetCurrentResourceName()}/image`,
  });
}

onNet("screencapture:captureStream", (token: string, options: object) => {
  SendNUIMessage({
    ...options,
    uploadToken: token,
    action: 'capture-stream-start',
    serverEndpoint: `http://${GetCurrentServerEndpoint()}/${GetCurrentResourceName()}/stream`,
  });
})

onNet("screencapture:INTERNAL:stopCaptureStream", () => {
  SendNUIMessage({
    action: 'capture-stream-stop',
  })
})