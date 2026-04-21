import { createServer } from './koa-router';
import './export';
import { eventController } from './event';
import { RequestUploadToken, createRegularUploadData } from './types';
import { UploadStore } from './upload-store';

export const uploadStore = new UploadStore();

async function boot() {
  createServer(uploadStore);
}

boot();

eventController<RequestUploadToken, string>(
  'screencapture:INTERNAL_requestUploadToken',
  async ({ ctx, body, send }) => {
    function uploadCallback(
      response: unknown,
      playerSource: number | undefined,
      correlationId: string | undefined,
    ): void {
      emitNet('screencapture:INTERNAL_uploadComplete', playerSource, JSON.stringify(response), correlationId);
    }

    const token = uploadStore.addUpload(createRegularUploadData({
      callback: uploadCallback,
      isRemote: true,
      remoteConfig: {
        filename: body ? body.filename : undefined,
        encoding: body.encoding,
        headers: body.headers,
        formField: 'file',
      },
      url: body.url,
      dataType: 'blob',
      playerSource: ctx.source,
      correlationId: body.correlationId,
    }));

    return send(token);
  },
);

import { processUpload, uploadFile, base64ToBuffer } from './process-upload';

onNet('screencapture:capture-screen', async (token: string, base64Data: string) => {
  try {
    const uploadData = uploadStore.getUpload(token);
    await processUpload(uploadData, base64Data);
  } catch (err) {
    console.error('[screencapture] capture-screen error:', err);
  }
});

onNet('screencapture:PerformUploadProxy', async (token: string, base64Data: string) => {
  const uploadData = uploadStore.getUpload(token);
  if (!uploadData) return;

  const { callback, url, remoteConfig, dataType, screenshotBasicCompatibility, playerSource, correlationId } = uploadData;

  try {
    const rawBuffer = base64ToBuffer(base64Data);

    const response = await uploadFile(url, remoteConfig, rawBuffer, 'blob'); // pass blob so createRequestBody creates FormData

    if (screenshotBasicCompatibility) {
      (callback as any)(false, response);
    } else {
      if (playerSource && correlationId) {
        (callback as any)(response, playerSource, correlationId);
      } else {
        (callback as any)(response);
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      if (screenshotBasicCompatibility) {
        (callback as any)(err.message, null);
      } else {
        if (playerSource && correlationId) {
          (callback as any)(JSON.stringify({ error: err.message }), playerSource, correlationId);
        } else {
          (callback as any)(JSON.stringify({ error: err.message }));
        }
      }
    } else {
      if (screenshotBasicCompatibility) {
        (callback as any)('An unknown error occurred', null);
      } else {
        if (playerSource && correlationId) {
          (callback as any)(JSON.stringify({ error: 'An unknown error occurred' }), playerSource, correlationId);
        } else {
          (callback as any)(JSON.stringify({ error: 'An unknown error occurred' }));
        }
      }
    }
  }
});
