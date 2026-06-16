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

// ── Live relay (startVideoStream) ────────────────────────────────────────────
// A relay stream forwards MSE-appendable segments to onSegment as they are
// produced instead of assembling a file on disk.
export type StreamSegment = {
  captureId: string;
  source: number;
  type: 'init' | 'media'; // 'init' = header/Tracks (append once); 'media' = one Cluster
  seq: number; // monotonic per stream
  data: string; // base64 of the WebM bytes
};

export type StreamSegmentFn = (segment: StreamSegment) => void;

export interface StreamUploadData {
  captureId: string;
  token: string;
  source: number;
  tempFilePath: string;
  bytesReceived: number;
  callback: CallbackFn;
  isRemote: boolean;
  remoteUrl?: string;
  remoteConfig?: StreamRemoteConfig;
  startedAt: number;
  duration?: number;
  legacyCallback?: boolean;

  // Live relay mode.
  relay?: boolean;
  onSegment?: StreamSegmentFn;
  // Runtime framing state (relay only) — see webm-stream.ts.
  pending?: Buffer;
  initSent?: boolean;
  segSeq?: number;
}

export type VideoCaptureResult = {
  captureId: string;
  source: number;
  status: 'success' | 'error';
  filePath?: string;
  response?: unknown;
  bytesReceived: number;
  duration?: number;
  reason?: 'manual' | 'duration' | 'finalized';
  error?: string;
};

// Remote upload config specific to video streams.
export interface StreamRemoteConfig {
  headers?: HeadersInit;
  formField?: string; // defaults to 'file'
  filename?: string; // becomes <filename>.webm — defaults to 'recording'
}

// Parameters accepted by UploadStore.addStream() — tempFilePath is derived
// from the generated token so it is not provided by the caller.
export type AddStreamParams = {
  captureId: string;
  source: number;
  tempDir: string;
  callback: CallbackFn;
  isRemote?: boolean;
  remoteUrl?: string;
  remoteConfig?: StreamRemoteConfig;
  duration?: number;
  legacyCallback?: boolean;
  // Live relay mode.
  relay?: boolean;
  onSegment?: StreamSegmentFn;
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
  duration?: number;
  // Live relay: WebM output chunk size (bytes) — smaller = lower latency. Passed
  // through to the NUI; defaults to 800 KiB there when omitted.
  streamChunkSize?: number;
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
