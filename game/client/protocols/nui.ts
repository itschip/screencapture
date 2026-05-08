import { clientCaptureMap, clientUploadTokenMap } from "../bootstrap";
import { ScreenshotCreatedBody } from "../types";

const imagesBps = parseInt(GetResourceMetadata(GetCurrentResourceName(), 'images_bps', 0), 10) || 500000;
const streamBps = parseInt(GetResourceMetadata(GetCurrentResourceName(), 'stream_bps', 0), 10) || 5000000;

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

on('__cfx_nui:screenshot_upload_proxy', (body: any, cb: (arg: any) => void) => {
  cb(true);

  if (body.id !== undefined && clientUploadTokenMap.has(body.id)) {
    const token = clientUploadTokenMap.get(body.id);
    if (token && body.data) {
      TriggerLatentServerEvent('screencapture:PerformUploadProxy', imagesBps, token, body.data);
    }
    clientUploadTokenMap.delete(body.id);
  }
});

on('__cfx_nui:capture_screen', (body: any, cb: (arg: any) => void) => {
    cb(true);

    const token = body.uploadToken
    if (token) {
        TriggerLatentServerEvent('screencapture:capture-screen', imagesBps, token, body.data);
    }
});

on('__cfx_nui:capture_stream_chunk', (body: any, cb: (arg: any) => void) => {
  cb(true);

  const { token, data } = body;
  if (token && data) {
    TriggerLatentServerEvent('screencapture:stream-chunk-nui', streamBps, token, data);
  }
});

on('__cfx_nui:capture_stream_finalize', (body: any, cb: (arg: any) => void) => {
  cb(true);

  const { token } = body;
  if (token) {
    emitNet('screencapture:stream-finalize-nui', token);
  }
});