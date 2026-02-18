import { nanoid } from 'nanoid';
import { StreamUploadData, UploadData } from './types';

export class UploadStore {
  #uploadMap: Map<string, UploadData>;
  #streamUploadMap: Map<string, StreamUploadData>;

  constructor() {
    this.#uploadMap = new Map<string, UploadData>();
    this.#streamUploadMap = new Map<string, StreamUploadData>();
  }

  addStream(params: StreamUploadData): string {
    const streamToken = nanoid(24);
    this.#streamUploadMap.set(streamToken, params);
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
}
