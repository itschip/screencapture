import path from 'node:path';
import { nanoid } from 'nanoid';
import { AddStreamParams, StreamUploadData, UploadData } from './types';

export class UploadStore {
  #uploadMap: Map<string, UploadData>;
  #streamUploadMap: Map<string, StreamUploadData>;
  #tokenToCaptureId: Map<string, string>;
  #sourceToCaptureId: Map<number, string>;

  constructor() {
    this.#uploadMap = new Map<string, UploadData>();
    this.#streamUploadMap = new Map<string, StreamUploadData>();
    this.#tokenToCaptureId = new Map<string, string>();
    this.#sourceToCaptureId = new Map<number, string>();
  }

  // Generates a token, derives the temp file path from it, and stores the stream entry.
  addStream(params: AddStreamParams): string {
    const streamToken = nanoid(24);
    const tempFilePath = path.join(params.tempDir, `${streamToken}.webm`);

    this.#streamUploadMap.set(params.captureId, {
      captureId: params.captureId,
      token: streamToken,
      source: params.source,
      tempFilePath,
      bytesReceived: 0,
      callback: params.callback,
      isRemote: params.isRemote ?? false,
      remoteUrl: params.remoteUrl,
      remoteConfig: params.remoteConfig,
      startedAt: Date.now(),
      duration: params.duration,
      legacyCallback: params.legacyCallback,
      // Live relay mode + framing state (used only when relay === true).
      relay: params.relay ?? false,
      onSegment: params.onSegment,
      pending: Buffer.alloc(0),
      initSent: false,
      segSeq: 0,
    });

    this.#tokenToCaptureId.set(streamToken, params.captureId);
    this.#sourceToCaptureId.set(params.source, params.captureId);

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
    const captureId = this.#tokenToCaptureId.get(token) ?? token;
    const data = this.#streamUploadMap.get(captureId);
    if (!data) throw new Error(`Stream data not found for token: ${token}`);
    return data;
  }

  getStreamByCaptureId(captureId: string): StreamUploadData {
    const data = this.#streamUploadMap.get(captureId);
    if (!data) throw new Error(`Stream data not found for capture ID: ${captureId}`);
    return data;
  }

  removeStream(token: string): void {
    const captureId = this.#tokenToCaptureId.get(token) ?? token;
    const data = this.#streamUploadMap.get(captureId);
    if (data) {
      this.#sourceToCaptureId.delete(data.source);
      this.#tokenToCaptureId.delete(data.token);
    }
    this.#streamUploadMap.delete(captureId);
  }

  getStreamTokenBySource(source: number): string | undefined {
    const captureId = this.#sourceToCaptureId.get(source);
    if (!captureId) return undefined;
    return this.#streamUploadMap.get(captureId)?.token;
  }

  getCaptureIdBySource(source: number): string | undefined {
    return this.#sourceToCaptureId.get(source);
  }

  hasActiveStreamForSource(source: number): boolean {
    return this.#sourceToCaptureId.has(source);
  }
}
