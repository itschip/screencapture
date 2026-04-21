import { request } from 'http';
import { netEventController } from './event';
import { CaptureRequest, RequestScreenshotUploadCB } from './types';
import { exportHandler, uuidv4 } from './utils';

import './protocols/nui';

export const clientCaptureMap = new Map<string, RequestScreenshotUploadCB>();
export const clientUploadTokenMap = new Map<string, string>();

RegisterNuiCallbackType('screenshot_created');
RegisterNuiCallbackType('screenshot_upload_proxy');
RegisterNuiCallbackType('capture_screen');

const protocol = GetResourceMetadata(GetCurrentResourceName(), 'protocol', 0) || 'http';
const serverEndpoint = `http://${GetCurrentServerEndpoint()}/${GetCurrentResourceName()}`;

onNet('screencapture:captureScreen', (token: string, options: object, dataType: string) => {
  if (protocol === 'nui') {
    return SendNUIMessage({
      ...options,
      uploadToken: token,
      callbackUrl: `https://${GetCurrentResourceName()}/capture_screen`,
      dataType,
      action: 'capture',
    });
  }

  SendNUIMessage({
    ...options,
    uploadToken: token,
    dataType,
    action: 'capture',
    serverEndpoint: `${serverEndpoint}/upload`,
  });
});

onNet('screencapture:INTERNAL_uploadComplete', (response: unknown, correlationId: string) => {
  const callback = clientCaptureMap.get(correlationId);
  if (callback) {
    callback(response);
    clientCaptureMap.delete(correlationId);
  }
});


async function requestScreenshotUpload(
  url: string,
  formField: string,
  optionsOrCB: CaptureRequest | RequestScreenshotUploadCB,
  callback: RequestScreenshotUploadCB,
) {
  const isOptions = typeof optionsOrCB === 'object' && optionsOrCB !== null;
  const realOptions = isOptions
    ? (optionsOrCB as CaptureRequest)
    : ({ headers: {}, encoding: 'webp' } as CaptureRequest);
  const realCallback = isOptions ? (callback as RequestScreenshotUploadCB) : (optionsOrCB as RequestScreenshotUploadCB);

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

  clientUploadTokenMap.set(correlationId, token);

  return createImageCaptureMessage({
    ...realOptions,
    formField,
    url,
    uploadToken: token,
    dataType: 'base64',
    correlationId,
    // since this goes through the nui proxy, this will stay like this.
    callbackUrl: `https://${GetCurrentResourceName()}/screenshot_upload_proxy`,
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
  },
);

function requestScreenshot(options: CaptureRequest, callback: RequestScreenshotUploadCB) {
  const correlationId = uuidv4();

  const realOptions =
    callback !== undefined
      ? options
      : ({
        encoding: 'jpg',
      } as CaptureRequest);

  const realCb = typeof callback === 'function' ? callback : typeof options === 'function' ? options : undefined;
  if (typeof realCb !== 'function') {
    return console.error('Callback is not a function');
  }

  clientCaptureMap.set(correlationId, realCb);

  createImageCaptureMessage({
    ...realOptions,
    callbackUrl: `https://${GetCurrentResourceName()}/screenshot_created`,
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
    ...(protocol === 'http' && { serverEndpoint: `${serverEndpoint}/upload` }),
  });
}

onNet('screencapture:captureStream', (token: string, options: object) => {
  SendNUIMessage({
    ...options,
    uploadToken: token,
    action: 'capture-stream-start',
    serverEndpoint: serverEndpoint,
  });
});

onNet('screencapture:INTERNAL:stopCaptureStream', () => {
  SendNUIMessage({
    action: 'capture-stream-stop',
  });
});
