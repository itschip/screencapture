export type DataType = 'base64' | 'blob';

type Encoding = 'webp' | 'jpg' | 'png';

export interface UploadData {
  callback: CallbackFn | ScreenshotBasicCallbackFn;
  isRemote: boolean;
  remoteConfig: CaptureOptions | null;
  dataType: DataType;
  url?: string;
  playerSource?: number;
  correlationId?: string;
  screenshotBasicCompatibility?: boolean;
}

export function createScreenshotBasicUploadData(
  params: Omit<UploadData, 'callback' | 'screenshotBasicCompatibility'> & { callback: ScreenshotBasicCallbackFn },
): UploadData {
  return {
    ...params,
    callback: params.callback,
    screenshotBasicCompatibility: true,
  };
}

export function createRegularUploadData(
  params: Omit<UploadData, 'callback' | 'screenshotBasicCompatibility'> & { callback: CallbackFn },
): UploadData {
  return {
    ...params,
    callback: params.callback,
    screenshotBasicCompatibility: false,
  };
}

export interface StreamUploadData {
  source: number;
  tempFilePath: string;
  bytesReceived: number;
  callback: CallbackFn;
  isRemote: boolean;
  remoteUrl?: string;
  remoteConfig?: StreamRemoteConfig;
}

// Remote upload config specific to video streams.
export interface StreamRemoteConfig {
  headers?: HeadersInit;
  formField?: string; // defaults to 'file'
  filename?: string; // becomes <filename>.webm — defaults to 'recording'
}

// Parameters accepted by UploadStore.addStream() — tempFilePath is derived
// from the generated token so it is not provided by the caller.
export type AddStreamParams = {
  source: number;
  tempDir: string;
  callback: CallbackFn;
  isRemote?: boolean;
  remoteUrl?: string;
  remoteConfig?: StreamRemoteConfig;
};

export interface RemoteConfig {
  url: string;
  headers?: HeadersInit;
  formField?: string;
  filename?: string;
  encoding?: string;
}

export interface CaptureOptions {
  headers?: HeadersInit;
  formField?: string;
  filename?: string;
  // screenshot-basic compatibility alias for filename
  fileName?: string;
  encoding?: string;
  maxWidth?: number;
  maxHeight?: number;
}

export type CallbackFn = (data: unknown, _playerSource?: number, correlationId?: string) => void;
export type ScreenshotBasicCallbackFn = (err: string | boolean, data: string) => void;

export interface CallbackData {
  imageData: string | Buffer<ArrayBuffer>;
  dataType: string;
}

export interface RequestBody {
  imageData: string;
  dataType: DataType;
}

export type RequestUploadToken = {
  url: string;
  encoding: Encoding;
  quality: number;
  headers: Headers;
  correlationId: string;
  filename: string;
};
