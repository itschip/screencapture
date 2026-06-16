import Koa from 'koa';
import Router from '@koa/router';
import { appendFile, readFile, unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';

// @ts-ignore - no types
import { setHttpCallback } from '@citizenfx/http-wrapper';
import { multer } from './multer';

import FormData from 'form-data';
import fetch from 'node-fetch';
import { StreamRemoteConfig, StreamUploadData, VideoCaptureResult } from './types';
import { UploadStore } from './upload-store';
import { processUpload } from './process-upload';
import { feedStream, flushStream } from './webm-stream';

const upload = multer({
  storage: multer.memoryStorage(),
});

declare function GetCurrentResourceName(): string;

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function createServer(uploadStore: UploadStore) {
  const app = new Koa();
  const router = new Router();

  app.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', '*');

    if (ctx.method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }
    await next();
  });

  router.post('/upload/:token', upload.single('file') as any, async (ctx) => {
    const token = ctx.params['token'] as string;
    if (!token) {
      ctx.status = 401;
      ctx.body = { status: 'error', message: 'No token provided' };
      return;
    }

    ctx.response.append('Access-Control-Allow-Origin', '*');
    ctx.response.append('Access-Control-Allow-Methods', 'GET, POST');

    const file = ctx.file;
    if (!file) {
      ctx.status = 400;
      ctx.body = { status: 'error', message: 'No file provided' };
      return;
    }

    try {
      const uploadData = uploadStore.getUpload(token);
      await processUpload(uploadData, file.buffer);

      ctx.status = 200;
      ctx.body = { status: 'success' };
    } catch (err) {
      console.error('[screencapture] upload error:', err);
      ctx.status = 500;
      ctx.body = { status: 'error', message: err instanceof Error ? err.message : 'An unknown error occurred' };
    }
  });

  router.post('/stream-chunk/:token', async (ctx) => {
    const token = ctx.params['token'] as string;

    try {
      const streamData = uploadStore.getStream(token);
      const chunk = await readRawBody(ctx.req);
      streamData.bytesReceived += chunk.length;

      // Relay streams forward MSE segments live; non-relay streams assemble on disk.
      if (streamData.relay) {
        feedStream(streamData, chunk);
      } else {
        await appendFile(streamData.tempFilePath, chunk);
      }

      ctx.status = 200;
      ctx.body = { ok: true };
    } catch (err) {
      console.error('[screencapture] stream-chunk error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  router.post('/stream-finalize/:token', async (ctx) => {
    const token = ctx.params['token'] as string;

    try {
      const streamData = uploadStore.getStream(token);
      uploadStore.removeStream(token);

      await finalizeStream(streamData);

      ctx.status = 200;
      ctx.body = { ok: true };
    } catch (err) {
      console.error('[screencapture] stream-finalize error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  app.use(router.routes()).use(router.allowedMethods());

  setHttpCallback(app.callback());
}

export async function finalizeStream(streamData: StreamUploadData): Promise<void> {
  const elapsedSeconds = Math.round((Date.now() - streamData.startedAt) / 1000);

  // Relay streams: flush the trailing Cluster, never touch disk.
  if (streamData.relay) {
    flushStream(streamData);
    streamData.callback(createVideoCaptureResult(streamData, { duration: elapsedSeconds }));
    return;
  }

  if (streamData.isRemote) {
    let videoBuffer: Buffer;
    try {
      videoBuffer = await readFile(streamData.tempFilePath);
    } finally {
      await unlink(streamData.tempFilePath).catch((err) =>
        console.error('[screencapture] failed to delete temp file:', err),
      );
    }

    let response: unknown;
    try {
      response = await uploadStreamFile(streamData.remoteUrl!, streamData.remoteConfig!, videoBuffer!);
    } catch (err) {
      if (!streamData.legacyCallback) {
        streamData.callback(createVideoCaptureErrorResult(streamData, err, elapsedSeconds));
      }

      throw err;
    }

    if (streamData.legacyCallback) {
      streamData.callback(response);
      return;
    }

    streamData.callback(createVideoCaptureResult(streamData, {
      response,
      duration: elapsedSeconds,
    }));
  } else {
    if (streamData.legacyCallback) {
      streamData.callback(streamData.tempFilePath);
      return;
    }

    streamData.callback(createVideoCaptureResult(streamData, {
      filePath: streamData.tempFilePath,
      duration: elapsedSeconds,
    }));
  }
}

function createVideoCaptureErrorResult(
  streamData: StreamUploadData,
  err: unknown,
  duration: number,
): VideoCaptureResult {
  return {
    captureId: streamData.captureId,
    source: streamData.source,
    status: 'error',
    bytesReceived: streamData.bytesReceived,
    duration,
    reason: 'finalized',
    error: err instanceof Error ? err.message : 'An unknown error occurred',
  };
}

function createVideoCaptureResult(
  streamData: StreamUploadData,
  data: Pick<VideoCaptureResult, 'filePath' | 'response' | 'duration'>,
): VideoCaptureResult {
  return {
    captureId: streamData.captureId,
    source: streamData.source,
    status: 'success',
    bytesReceived: streamData.bytesReceived,
    reason: 'finalized',
    ...data,
  };
}

async function uploadStreamFile(url: string, config: StreamRemoteConfig, buf: Buffer): Promise<unknown> {
  const formData = new FormData();
  const filename = config.filename ? `${config.filename}.webm` : 'recording.webm';

  formData.append(config.formField ?? 'file', buf, {
    filename,
    contentType: 'video/webm',
    knownLength: buf.length,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...formData.getHeaders(),
      ...((config.headers as Record<string, string>) ?? {}),
    },
    body: formData.getBuffer(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Video upload failed: ${response.status} — ${text}`);
  }

  return response.json();
}
