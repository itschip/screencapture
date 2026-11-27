import { eventController } from './event';
import { RequestUploadToken, createRegularUploadData } from './types';
import { uploadStore } from './bootstrap';
import { processUpload, uploadFile, base64ToBuffer } from './process-upload';
import { emitNetToPlayer } from './net';
import { getEventContext } from './context';

type ImageKind = 'proxy' | 'capture';

type PendingImage = {
  kind: ImageKind;
  source: number;
  total: number;
  received: number;
  chunks: string[];
  timeout: ReturnType<typeof setTimeout>;
};

// 128 chunks * 256 KB = 32 MB of base64, far above any real screenshot.
const maxImageChunks = 128;
const pendingImageTimeout = 60000;
const pendingImages = new Map<string, PendingImage>();

export function registerImageHandlers() {
  eventController<RequestUploadToken, string>(
    'screencapture:INTERNAL_requestUploadToken',
    async ({ ctx, body, send }) => {
      function uploadCallback(
        response: unknown,
        playerSource: number | undefined,
        correlationId: string | undefined,
      ): void {
        emitNetToPlayer(
          'screencapture:INTERNAL_uploadComplete',
          playerSource,
          JSON.stringify(response),
          correlationId,
        );
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

  const captureScreen = async (token: string, base64Data: string) => {
    try {
      const uploadData = uploadStore.getUpload(token);
      uploadStore.removeUpload(token);

      await processUpload(uploadData, base64Data);
    } catch (err) {
      console.error('[screencapture] capture-screen error:', err);
    }
  };

  const performUploadProxy = async (token: string, base64Data: string) => {
    const uploadData = uploadStore.getUpload(token);
    if (!uploadData) return;

    uploadStore.removeUpload(token);

    const { callback, url, remoteConfig, dataType, screenshotBasicCompatibility, playerSource, correlationId } = uploadData;

    try {
      const rawBuffer = base64ToBuffer(base64Data);

      const response = await uploadFile(url, remoteConfig, rawBuffer, 'blob', uploadData);

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
  };

  onNet(
    'screencapture:image-chunk-nui',
    async (responseEvent: string, kind: ImageKind, token: string, index: number, total: number, data: string) => {
      const { source } = getEventContext();
      const ack = (ok: boolean, error?: string) => emitNetToPlayer(responseEvent, source, { ok, error });

      if (kind !== 'proxy' && kind !== 'capture') return ack(false, 'Invalid upload kind');

      let pending = pendingImages.get(token);
      if (!pending) {
        if (!uploadStore.hasUpload(token)) return ack(false, 'Unknown upload token');

        const owner = uploadStore.getUpload(token).playerSource;
        if (owner && owner !== source) return ack(false, 'Upload token belongs to another player');

        if (!Number.isInteger(total) || total < 1 || total > maxImageChunks) return ack(false, 'Invalid chunk count');

        pending = {
          kind,
          source,
          total,
          received: 0,
          chunks: new Array(total),
          timeout: setTimeout(() => pendingImages.delete(token), pendingImageTimeout),
        };
        pendingImages.set(token, pending);
      }

      if (pending.source !== source || pending.kind !== kind || pending.total !== total) {
        return ack(false, 'Chunk does not match upload');
      }

      if (!Number.isInteger(index) || index < 0 || index >= total || typeof data !== 'string') {
        return ack(false, 'Invalid chunk');
      }

      if (pending.chunks[index] === undefined) {
        pending.chunks[index] = data;
        pending.received++;
      }

      ack(true);

      if (pending.received < pending.total) return;

      clearTimeout(pending.timeout);
      pendingImages.delete(token);

      const base64Data = pending.chunks.join('');
      if (kind === 'proxy') {
        await performUploadProxy(token, base64Data);
      } else {
        await captureScreen(token, base64Data);
      }
    },
  );
}
