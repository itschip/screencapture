import Koa from 'koa';
import Router from '@koa/router';
import { writeFileSync } from 'fs';
import { appendFile, readFile, unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';

// @ts-ignore - no types
import { setHttpCallback } from '@citizenfx/http-wrapper';
import { multer } from './multer';

import FormData from 'form-data';
import fetch from 'node-fetch';
import { Blob } from 'node:buffer';
import { CaptureOptions, DataType, StreamRemoteConfig } from './types';
import { UploadStore } from './upload-store';

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

    const {
      callback,
      dataType,
      isRemote,
      remoteConfig,
      url,
      playerSource,
      correlationId,
      screenshotBasicCompatibility,
    } = uploadStore.getUpload(token);

    if (!ctx.files) {
      ctx.status = 400;
      ctx.body = { status: 'error', message: 'No file provided' };
    }

    const file = ctx.file;

    try {
      const encoding = remoteConfig?.encoding || 'webp';
      // base64 or buffer
      const buf = await buffer(dataType, file.buffer, encoding);

      if (isRemote) {
        const response = await uploadFile(url, remoteConfig, buf, dataType);

        if (screenshotBasicCompatibility) {
          (callback as any)(false, response);
        } else {
          if (playerSource && correlationId) {
            (callback as any)(response, playerSource, correlationId);
          } else {
            (callback as any)(response);
          }
        }
      } else {
        if (screenshotBasicCompatibility) {
          // this will be a base64 string
          if (remoteConfig?.fileName) {
            const filename = saveFileToDisk(remoteConfig.fileName, buf);
            (callback as any)(false, filename);
          } else {
            (callback as any)(false, buf);
          }
        } else {
          (callback as any)(buf);
        }
      }

      ctx.status = 200;
      ctx.body = { status: 'success' };
    } catch (err) {
      if (err instanceof Error) {
        if (screenshotBasicCompatibility) {
          (callback as any)(err.message, null);
        } else {
          (callback as any)(err);
        }

        ctx.status = 500;
        ctx.body = { status: 'error', message: err.message };
      } else {
        if (screenshotBasicCompatibility) {
          (callback as any)('An unknown error occurred', null);
        } else {
          (callback as any)(new Error('An unknown error occurred'));
        }

        ctx.status = 500;
        ctx.body = { status: 'error', message: 'An unknown error occurred' };
      }
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

export async function uploadFile(
  url: string | undefined,
  config: CaptureOptions | null,
  buf: string | Buffer,
  dataType: DataType,
) {
  if (!url) throw new Error('No remote URL provided');
  if (!config) throw new Error('No remote config provided');

  try {
    const body = await createRequestBody(buf, dataType, config);

    let response;
    if (body instanceof FormData) {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          ...body.getHeaders(),
          ...config.headers,
        },
        body: body.getBuffer(),
      });
    } else {
      response = await fetch(url, {
        method: 'POST',
        headers: config.headers || {},
        body: body as any,
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to upload file to ${url}. Status: ${response.status}. Response: ${text}`);
    }

    const res = await response.json();
    return res;
  } catch (err) {
    console.error('Error uploading file:', err);
    if (err instanceof Error) {
      throw new Error(err.message);
    }
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

function createRequestBody(
  buf: string | Buffer,
  dataType: DataType,
  config: CaptureOptions,
): Promise<BodyInit | FormData> {
  return new Promise((resolve, reject) => {
    const { formField, filename } = config;

    const filenameExt = filename ? `${filename}.${config.encoding}` : `screenshot.${config.encoding}`;

    if (dataType === 'blob') {
      const formData = new FormData();
      formData.append(formField || 'file', buf, {
        filename: filenameExt,
        knownLength: (buf as Buffer).length,
      });
      if (filename) {
        formData.append('filename', filename);
      }

      return resolve(formData);
    }

    if (typeof buf === 'string' && dataType === 'base64') {
      return resolve(buf);
    }

    return reject('Invalid body data');
  });
}

export async function buffer(
  dataType: DataType,
  imageData: Buffer,
  encoding: string = 'webp',
): Promise<string | Buffer> {
  return new Promise(async (resolve, reject) => {
    if (dataType === 'base64') {
      const blob = new Blob([imageData]);
      const dataURL = await blobToBase64(blob, encoding);
      resolve(dataURL);
    } else {
      resolve(imageData);
    }
  });
}

export function base64ToBuffer(data: string): Buffer {
  const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (matches && matches[2]) {
    return Buffer.from(matches[2], 'base64');
  }
  return Buffer.from(data, 'base64');
}

async function blobToBase64(blob: Blob, encoding: string = 'webp'): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      const mimeType = getMimeType(encoding);

      resolve(`data:${mimeType};base64,${base64}`);
    } catch (err) {
      reject(err);
    }
  });
}

function getMimeType(encoding: string): string {
  switch (encoding.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/webp';
  }
}

function saveFileToDisk(fileName: string, data: string | Buffer) {
  try {
    writeFileSync(fileName, data);
    return fileName;
  } catch (err) {
    console.error('Error saving file to disk:', err);
    throw new Error('Error saving file to disk');
  }
}
