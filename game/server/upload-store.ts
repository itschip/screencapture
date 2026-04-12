import path from 'node:path';
import { nanoid } from 'nanoid';
import { AddStreamParams, StreamUploadData, UploadData } from './types';

export class UploadStore {
  #uploadMap: Map<string, UploadData>;
  #streamUploadMap: Map<string, StreamUploadData>;
  // Reverse lookup: player source → active stream token
  #sourceToStreamToken: Map<number, string>;

  constructor() {
    this.#uploadMap = new Map<string, UploadData>();
    this.#streamUploadMap = new Map<string, StreamUploadData>();
    this.#sourceToStreamToken = new Map<number, string>();
  }

  // Generates a token, derives the temp file path from it, and stores the stream entry.
  addStream(params: AddStreamParams): string {
    const streamToken = nanoid(24);
    const tempFilePath = path.join(params.tempDir, `${streamToken}.webm`);

    this.#streamUploadMap.set(streamToken, {
      source: params.source,
      tempFilePath,
      bytesReceived: 0,
      callback: params.callback,
      isRemote: params.isRemote ?? false,
      remoteUrl: params.remoteUrl,
      remoteConfig: params.remoteConfig,
    });

    this.#sourceToStreamToken.set(params.source, streamToken);

    return streamToken;
  }

  addUpload(params: UploadData): string {
    const uploadToken = nanoid(24);
    this.#uploadMap.set(uploadToken, params);
    return uploadToken;
  }

  getUpload(uploadToken: string): UploadData {
    const exists = this.#uploadMap.has(uploadToken);
    if (!exists) {
      throw new Error('Upload data does not exist. Cancelling screen capture.');
    }

    const data = this.#uploadMap.get(uploadToken);
    if (!data) throw new Error('Could not find upload data');

    return data;
  }

  getStream(token: string): StreamUploadData {
    const data = this.#streamUploadMap.get(token);
    if (!data) throw new Error(`Stream data not found for token: ${token}`);
    return data;
  }

  removeStream(token: string): void {
    const data = this.#streamUploadMap.get(token);
    if (data) {
      this.#sourceToStreamToken.delete(data.source);
    }
    this.#streamUploadMap.delete(token);
  }

  getStreamTokenBySource(source: number): string | undefined {
    return this.#sourceToStreamToken.get(source);
  }
}
