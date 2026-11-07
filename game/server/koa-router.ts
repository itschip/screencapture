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
import { captureUploadMetric, getUploadMetricHttpStatus } from './metrics';
import { createUploadHeaders, formatUploadErrorMessage, getUploadHost } from './upload-identity-headers';
import { getUploadAgent } from './upload-agent';

// Screenshots only; videos go through the stream routes.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
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

  // Reject unknown tokens before multer buffers the request body in memory.
  const requireUploadToken: Koa.Middleware = async (ctx, next) => {
    if (!uploadStore.hasUpload(ctx.params['token'] as string)) {
      ctx.status = 401;
      ctx.body = { status: 'error', message: 'Invalid upload token' };
      return;
    }

    try {
      await next();
    } catch (err) {
      if ((err as { code?: string }).code !== 'LIMIT_FILE_SIZE') throw err;
      ctx.status = 413;
      ctx.body = { status: 'error', message: 'File too large' };
    }
  };

  router.post('/upload/:token', requireUploadToken, upload.single('file') as any, async (ctx) => {
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
      uploadStore.removeUpload(token);

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

      await appendFile(streamData.tempFilePath, chunk);
      streamData.bytesReceived += chunk.length;

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
      response = await uploadStreamFile(streamData, videoBuffer!);
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

async function uploadStreamFile(streamData: StreamUploadData, buf: Buffer): Promise<unknown> {
  const url = streamData.remoteUrl;
  const config = streamData.remoteConfig;

  if (!url) throw new Error('No remote video upload URL provided');
  if (!config) throw new Error('No remote video upload config provided');

  const formData = new FormData();
  const filename = config.filename ? `${config.filename}.webm` : 'recording.webm';

  formData.append(config.formField ?? 'file', buf, {
    filename,
    contentType: 'video/webm',
    knownLength: buf.length,
  });

  const headers = createUploadHeaders(url, config.headers);
  console.log('[screencapture] Uploading stream to remote host:', getUploadHost(url) ?? 'unknown');

  const startedAt = Date.now();
  captureUploadMetric({
    event: 'upload_started',
    kind: 'video',
    status: 'started',
    uploadUrl: url,
    bytes: buf.length,
    captureId: streamData.captureId,
    source: streamData.source,
  });

  try {
    const response = await fetch(url, {
      agent: getUploadAgent(),
      method: 'POST',
      headers: {
        ...formData.getHeaders(),
        ...headers,
      },
      body: formData.getBuffer(),
    });

    if (!response.ok) {
      const error = new Error(`Video upload failed with HTTP ${response.status}`);
      (error as Error & { httpStatus?: number }).httpStatus = response.status;
      throw error;
    }

    const result = await response.json();
    captureUploadMetric({
      event: 'upload_finished',
      kind: 'video',
      status: 'success',
      uploadUrl: url,
      httpStatus: response.status,
      bytes: buf.length,
      durationMs: Date.now() - startedAt,
      captureId: streamData.captureId,
      source: streamData.source,
    });

    return result;
  } catch (err) {
    captureUploadMetric({
      event: 'upload_failed',
      kind: 'video',
      status: 'failed',
      uploadUrl: url,
      httpStatus: getUploadMetricHttpStatus(err),
      bytes: buf.length,
      durationMs: Date.now() - startedAt,
      captureId: streamData.captureId,
      source: streamData.source,
    });

    throw new Error(formatUploadErrorMessage('video', url, err));
  }
}
