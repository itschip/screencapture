import { netEventController } from './event';
import { CaptureRequest, LiveStreamClientRequest, RequestScreenshotUploadCB } from './types';
import { exportHandler, uuidv4 } from './utils';

import './protocols/nui';

export const clientCaptureMap = new Map<string, RequestScreenshotUploadCB>();
export const clientUploadTokenMap = new Map<string, string>();

RegisterNuiCallbackType('screenshot_created');
RegisterNuiCallbackType('screenshot_upload_proxy');
RegisterNuiCallbackType('capture_screen');
RegisterNuiCallbackType('capture_stream_chunk');
RegisterNuiCallbackType('capture_stream_finalize');
RegisterNuiCallbackType('live_stream_status');

const protocol = (GetResourceMetadata(GetCurrentResourceName(), 'protocol', 0) || 'nui').trim().toLowerCase();

function getServerEndpoint(): string | undefined {
  // Keep the old 'http' transport name as an alias, but require HTTPS under cerulean.
  if (protocol !== 'https' && protocol !== 'http') {
    console.error(`[screencapture] Unsupported capture protocol '${protocol}'. Use 'nui' or 'https'.`);
    return;
  }

  const endpoint = GetConvar('screencapture_https_endpoint', '').trim().replace(/\/+$/, '');
  // Keep validation independent of browser APIs in the client runtime. Accept an
  // HTTPS base URL, without credentials, a query, a fragment, or backslashes.
  if (!/^https:\/\/[^/?#\\\s@]+(?:\/[^?#\\\s]*)?$/i.test(endpoint)) {
    console.error(
      '[screencapture] HTTPS capture requires a public HTTPS base URL. Configure setr screencapture_https_endpoint "https://capture.example.com" in server.cfg.',
    );
    return;
  }

  return `${endpoint}/${GetCurrentResourceName()}`;
}

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

  const serverEndpoint = getServerEndpoint();
  if (!serverEndpoint) return;

  SendNUIMessage({
    ...options,
    uploadToken: token,
    dataType,
    action: 'capture',
    callbackUrl: undefined,
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

  const serverEndpoint = protocol === 'nui' ? undefined : getServerEndpoint();
  if (protocol !== 'nui' && !serverEndpoint) return;

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

  if (!serverEndpoint) clientUploadTokenMap.set(correlationId, token);

  return createImageCaptureMessage({
    ...realOptions,
    formField,
    url,
    uploadToken: token,
    dataType: 'base64',
    correlationId,
    serverEndpoint: serverEndpoint ? `${serverEndpoint}/upload` : undefined,
    callbackUrl: serverEndpoint ? undefined : `https://${GetCurrentResourceName()}/screenshot_upload_proxy`,
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
  });
}

onNet('screencapture:captureStream', (token: string, options: object, captureId?: string) => {
  if (protocol === 'nui') {
    return SendNUIMessage({
      ...options,
      captureId,
      uploadToken: token,
      action: 'capture-stream-start',
      callbackUrl: `https://${GetCurrentResourceName()}/capture_stream_chunk`,
      finalizeCallbackUrl: `https://${GetCurrentResourceName()}/capture_stream_finalize`,
    });
  }

  const serverEndpoint = getServerEndpoint();
  if (!serverEndpoint) return;

  SendNUIMessage({
    ...options,
    captureId,
    uploadToken: token,
    action: 'capture-stream-start',
    callbackUrl: undefined,
    finalizeCallbackUrl: undefined,
    serverEndpoint: serverEndpoint,
  });
});

onNet('screencapture:INTERNAL:stopCaptureStream', (captureId?: string) => {
  SendNUIMessage({
    action: 'capture-stream-stop',
    captureId,
  });
});

onNet('screencapture:liveStream:start', (request: LiveStreamClientRequest) => {
  SendNUIMessage({
    ...request,
    action: 'live-stream-start',
    statusCallbackUrl: `https://${GetCurrentResourceName()}/live_stream_status`,
  });
});

onNet('screencapture:liveStream:stop', (streamId?: string) => {
  SendNUIMessage({
    action: 'live-stream-stop',
    streamId,
  });
});
