import Koa from 'koa';
import Router from '@koa/router';
import { appendFile, readFile, unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';

// @ts-ignore - no types
import { setHttpCallback } from '@citizenfx/http-wrapper';
import { multer } from './multer';

import FormData from 'form-data';
import fetch from 'node-fetch';
import { StreamRemoteConfig, StreamUploadData } from './types';
import { UploadStore } from './upload-store';
import { processUpload } from './process-upload';

const upload = multer({
  storage: multer.memoryStorage(),
});

declare function GetCurrentResourceName(): string;

// Reads the raw request body as a Buffer without any parsing middleware.
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

  // Receive a raw binary chunk and append it to the stream's temp file.
  // NUI sends chunks sequentially, waiting for a 200 before sending the next,
  // so the file is assembled in order.
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

  // Called by NUI after output.finalize() — all chunks have been delivered.
  // Branches on isRemote:
  //   remote → read file → upload to URL → delete file → callback(remoteResponse)
  //   local  → callback(tempFilePath), caller owns the file
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

// Shared finalization logic used by both the HTTP route and NUI event handler.
// Branches on isRemote:
//   remote → read file → upload to URL → delete file → callback(remoteResponse)
//   local  → callback(tempFilePath), caller owns the file
export async function finalizeStream(streamData: StreamUploadData): Promise<void> {
  if (streamData.isRemote) {
    // Read the assembled file into memory, then immediately delete it —
    // we do this in a try/finally so the file is always cleaned up even
    // if the remote upload throws.
    let videoBuffer: Buffer;
    try {
      videoBuffer = await readFile(streamData.tempFilePath);
    } finally {
      await unlink(streamData.tempFilePath).catch((err) =>
        console.error('[screencapture] failed to delete temp file:', err),
      );
    }

    const response = await uploadStreamFile(streamData.remoteUrl!, streamData.remoteConfig!, videoBuffer!);

    streamData.callback(response);
  } else {
    // Node.js Buffer → Lua marshaling is broken (Buffer serialises as a
    // 0-indexed table, giving #data = 0 in Lua). Pass the path string instead.
    streamData.callback(streamData.tempFilePath);
  }
}

// Uploads a completed WebM video Buffer to a remote URL via multipart FormData.
// Kept separate from uploadFile() since video always uses video/webm content-type
// and doesn't need the base64/blob DataType branching that images require.
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
