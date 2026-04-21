import { writeFileSync } from 'fs';
import { Blob } from 'node:buffer';

import FormData from 'form-data';
import fetch from 'node-fetch';

import { CaptureOptions, DataType, UploadData } from './types';

export async function processUpload(uploadData: UploadData, imageData: Buffer | string): Promise<void> {
  const {
    callback,
    dataType,
    isRemote,
    remoteConfig,
    url,
    playerSource,
    correlationId,
    screenshotBasicCompatibility,
  } = uploadData;

  const encoding = remoteConfig?.encoding || 'webp';

  // short-circuit and avoid a needless decode → re-encode round-trip.
  let processed: string | Buffer;

  if (dataType === 'base64') {
    if (typeof imageData === 'string') {
      processed = imageData;
    } else {
      processed = await buffer('base64', imageData, encoding);
    }
  } else {
    // dataType === 'blob'
    if (typeof imageData === 'string') {
      processed = base64ToBuffer(imageData);
    } else {
      processed = imageData;
    }
  }

  if (isRemote) {
    const response = await uploadFile(url, remoteConfig, processed, dataType);

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
      if (remoteConfig?.fileName) {
        const filename = saveFileToDisk(remoteConfig.fileName, processed);
        (callback as any)(false, filename);
      } else {
        (callback as any)(false, processed);
      }
    } else {
      (callback as any)(processed);
    }
  }
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

function saveFileToDisk(fileName: string, data: string | Buffer): string {
  try {
    writeFileSync(fileName, data);
    return fileName;
  } catch (err) {
    console.error('Error saving file to disk:', err);
    throw new Error('Error saving file to disk');
  }
}
