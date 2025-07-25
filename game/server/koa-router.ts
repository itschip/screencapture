import Koa from 'koa';
import Router from '@koa/router';

// @ts-ignore - no types
import { setHttpCallback } from '@citizenfx/http-wrapper';
import { multer } from './multer'

import FormData from 'form-data';
import fetch from 'node-fetch';
import { Blob } from 'node:buffer';
import { CaptureOptions, DataType } from './types';
import { UploadStore } from './upload-store';

const upload = multer({
  storage: multer.memoryStorage()
});

export async function createServer(uploadStore: UploadStore) {
  const app = new Koa();
  const router = new Router();

  router.post('/image', upload.single('file') as any, async (ctx) => {
    const token = ctx.request.headers['x-screencapture-token'] as string;
    if (!token) {
      ctx.status = 401;
      ctx.body = { status: 'error', message: 'No token provided' };
      return;
    }

    ctx.response.append('Access-Control-Allow-Origin', '*');
    ctx.response.append('Access-Control-Allow-Methods', 'GET, POST');

    const { callback, dataType, isRemote, remoteConfig, url, playerSource, correlationId } =
      uploadStore.getUpload(token);

    if (!ctx.files) {
      ctx.status = 400;
      ctx.body = { status: 'error', message: 'No file provided' };
    }

    const file = ctx.file;

    try {
      // Get encoding from remoteConfig or default to 'webp'
      const encoding = remoteConfig?.encoding || 'webp';
      const buf = await buffer(dataType, file.buffer, encoding);

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

  app
    .use(router.routes())
    .use(router.allowedMethods());

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
    console.error('Error uploading file:', err);
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

async function buffer(dataType: DataType, imageData: Buffer, encoding: string = 'webp'): Promise<string | Buffer> {
  return new Promise(async (resolve, reject) => {
    if (dataType === 'base64') {
      // i just want to give a big shoutout to CFX for making node22 so fucking shit
      // to node16: I'm sorry you get blamed for experimental buffer.Blob warnings, its not your fault
      const blob = new Blob([imageData]);
      const dataURL = await blobToBase64(blob, encoding);
      resolve(dataURL);
    } else {
      resolve(imageData);
    }
  });
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
