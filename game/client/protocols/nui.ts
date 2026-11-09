import { clientCaptureMap, clientUploadTokenMap } from "../bootstrap";
import { LiveStreamStatus, ScreenshotCreatedBody } from "../types";
import { uniqueId } from "../event";

const imagesBps = parseInt(GetResourceMetadata(GetCurrentResourceName(), 'images_bps', 0), 10) || 500000;
const streamBps = parseInt(GetResourceMetadata(GetCurrentResourceName(), 'stream_bps', 0), 10) || 5000000;
const streamAckTimeout = 60000;

type StreamAck = {
  ok: boolean;
  error?: string;
};

function waitForStreamAck(responseEvent: string): Promise<StreamAck> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      removeEventListener(responseEvent, eventListener);
      resolve({ ok: false, error: 'Timed out waiting for stream acknowledgement' });
    }, streamAckTimeout);

    const eventListener = (response: StreamAck) => {
      clearTimeout(timeout);
      removeEventListener(responseEvent, eventListener);
      resolve(response);
    };

    onNet(responseEvent, eventListener);
  });
}

async function sendStreamChunk(token: string, data: string): Promise<StreamAck> {
  const responseEvent = `screencapture:stream-chunk-nui:${uniqueId()}`;
  const response = waitForStreamAck(responseEvent);

  TriggerLatentServerEvent('screencapture:stream-chunk-nui', streamBps, responseEvent, token, data);

  return response;
}

// A whole screenshot in one latent event can crash the client with
// "Latent event packet overflow", so images are sent in acknowledged chunks.
const imageChunkSize = 256 * 1024;

async function sendImageChunked(kind: 'proxy' | 'capture', token: string, data: string): Promise<void> {
  const total = Math.ceil(data.length / imageChunkSize);

  for (let index = 0; index < total; index++) {
    const responseEvent = `screencapture:image-chunk-nui:${uniqueId()}`;
    const response = waitForStreamAck(responseEvent);
    const chunk = data.slice(index * imageChunkSize, (index + 1) * imageChunkSize);

    TriggerLatentServerEvent('screencapture:image-chunk-nui', imagesBps, responseEvent, kind, token, index, total, chunk);

    const ack = await response;
    if (!ack.ok) {
      console.error(`[screencapture] image chunk ${index + 1}/${total} failed: ${ack.error}`);
      return;
    }
  }
}

async function finalizeStream(token: string): Promise<StreamAck> {
  const responseEvent = `screencapture:stream-finalize-nui:${uniqueId()}`;
  const response = waitForStreamAck(responseEvent);

  emitNet('screencapture:stream-finalize-nui', responseEvent, token);

  return response;
}

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
      sendImageChunked('proxy', token, body.data);
    }
    clientUploadTokenMap.delete(body.id);
  }
});

on('__cfx_nui:capture_screen', (body: any, cb: (arg: any) => void) => {
    cb(true);

    const token = body.uploadToken
    if (token && body.data) {
        sendImageChunked('capture', token, body.data);
    }
});

on('__cfx_nui:capture_stream_chunk', async (body: any, cb: (arg: any) => void) => {
  const { token, data } = body;
  if (token && data) {
    cb(await sendStreamChunk(token, data));
    return;
  }

  cb({ ok: false, error: 'Missing stream token or data' });
});

on('__cfx_nui:capture_stream_finalize', async (body: any, cb: (arg: any) => void) => {
  const { token } = body;
  if (token) {
    cb(await finalizeStream(token));
    return;
  }

  cb({ ok: false, error: 'Missing stream token' });
});

on('__cfx_nui:live_stream_status', (body: LiveStreamStatus, cb: (arg: unknown) => void) => {
  cb({ ok: true });
  emitNet('screencapture:liveStream:status', body);
});