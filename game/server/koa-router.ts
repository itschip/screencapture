import Koa from 'koa';
import Router from '@koa/router';
import { multer } from './multer'

// @ts-ignore - no types
import { setHttpCallback } from '@citizenfx/http-wrapper';

import FormData from 'form-data';
import fetch from 'node-fetch';
import { Blob } from 'node:buffer';
import { CaptureOptions, DataType } from './types';
import { UploadStore } from './upload-store';

export async function createServer(uploadStore: UploadStore) {
  const app = new Koa();
  const router = new Router();
  const upload = multer({
    storage: multer.memoryStorage()
  });

  router.post('/image', upload.single("file") as any, async (ctx) => {
    const token = ctx.request.headers['x-screencapture-token'] as string;
    if (!token) {
      ctx.status = 401;
      ctx.body = { status: 'error', message: 'No token provided' };
      return;
    }

    const { callback, dataType, isRemote, remoteConfig, url, playerSource, correlationId } =
      uploadStore.getUpload(token);

    const file = ctx.file;
    if (!file) {
      ctx.status = 400;
      ctx.body = { status: 'error', message: 'No file provided' };
      return;
    }

    try {

      const buf = await buffer(dataType, file.buffer);

      if (isRemote) {
        const response = await uploadFile(url, remoteConfig, buf, dataType);

        // this is only when we return data back to the client
        if (playerSource && correlationId) {
          callback(response, playerSource, correlationId);
        } else {
          callback(response);
        }
      } else {
        callback(buf);
      }

      ctx.status = 200;
      ctx.body = { status: 'success' };
    } catch (err) {
      if (err instanceof Error) {
        ctx.status = 500;
        ctx.body = { status: 'error', message: err.message };
      } else {
        ctx.status = 500;
        ctx.body = { status: 'error', message: 'An unknown error occurred' };
      }
    }
  });

  app.use(router.routes()).use(router.allowedMethods());

  setHttpCallback(app.callback());
}

async function uploadFile(
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
        // as soon as we get a node upgrade, we'll use Node's http module
        // we might be able to do it now, but if so I'll test that later
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
    if (err instanceof Error) {
      throw new Error(err.message);
    }
  }
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
      formData.append(formField || 'file', buf, filenameExt);
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

async function buffer(dataType: DataType, imageData: Buffer): Promise<string | Buffer> {
  return new Promise(async (resolve, reject) => {
    if (dataType === 'base64') {
      const blob = new Blob([imageData]);
      const dateURL = await blobToBase64(blob);
      resolve(dateURL);
    } else {
      resolve(imageData);
    }
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      resolve(base64);
    } catch (err) {
      reject(err);
    }
  });
}
