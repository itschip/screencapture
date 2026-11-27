import { CaptureStreamActions } from './types';
import { captureSessionCoordinator } from './capture-session-coordinator';
import { GameMediaSource } from './game-media-source';
import { Output, WebMOutputFormat, StreamTarget, MediaStreamVideoTrackSource, QUALITY_MEDIUM } from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';

const HTTP_CHUNK_SIZE = 800 * 1024;
// 192 KiB of video becomes 256 KiB after base64 encoding for the latent event.
const NUI_CHUNK_SIZE = 192 * 1024;

type CaptureStreamHttpRequest = {
  action: CaptureStreamActions;
  captureId?: string;
  uploadToken: string;
  serverEndpoint: string;
  callbackUrl?: never;
  finalizeCallbackUrl?: never;
  maxWidth?: number;
  maxHeight?: number;
  duration?: number;
};

type CaptureStreamNuiRequest = {
  action: CaptureStreamActions;
  captureId?: string;
  uploadToken: string;
  serverEndpoint?: never;
  callbackUrl: string;
  finalizeCallbackUrl: string;
  maxWidth?: number;
  maxHeight?: number;
  duration?: number;
};

type CaptureStreamRequest = CaptureStreamHttpRequest | CaptureStreamNuiRequest;

export class CaptureStream {
  #gameMediaSource = new GameMediaSource();
  #output: Output | null = null;
  #videoSource: MediaStreamVideoTrackSource | null = null;
  #mediaStream: MediaStream | null = null;
  #durationTimeout: ReturnType<typeof setTimeout> | null = null;
  #captureId: string | null = null;
  #leaseId: string | null = null;
  #stopping = false;

  start() {
    window.addEventListener('message', async (event) => {
      const data = event.data as CaptureStreamRequest;

      if (data.action === CaptureStreamActions.Start) {
        try {
          await this.stream(data);
        } catch (error) {
          console.error('[screencapture] failed to start video capture:', error);
        }
      }

      if (data.action === CaptureStreamActions.Stop) {
        if (data.captureId && this.#captureId && data.captureId !== this.#captureId) {
          return;
        }

        await this.stop();
      }
    });

    window.addEventListener('resize', () => {
      this.#gameMediaSource.resize();
    });
  }

  private async assertCallbackResponse(response: Response, context: string): Promise<void> {
    if (!response.ok) {
      throw new Error(`${context} failed: ${response.status}`);
    }

    const result = await response.json().catch(() => true);
    if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
      throw new Error(`${context} failed: ${result.error ?? 'Unknown error'}`);
    }
  }

  async stream(request: CaptureStreamRequest) {
    if (this.#output || this.#gameMediaSource.active || this.#mediaStream) {
      console.error('[screencapture] video capture is already active');
      return;
    }

    const leaseId = request.captureId ?? 'capture-stream';
    if (!captureSessionCoordinator.acquire('recording', leaseId)) {
      console.error('[screencapture] another video capture session is already active');
      return;
    }

    const { uploadToken, serverEndpoint, callbackUrl, finalizeCallbackUrl } = request;

    this.#captureId = request.captureId ?? null;
    this.#leaseId = leaseId;
    this.#stopping = false;

    try {
      const writable = callbackUrl
        ? this.createNuiWritableStream(uploadToken, callbackUrl, finalizeCallbackUrl!)
        : this.createHttpWritableStream(uploadToken, serverEndpoint!);

      this.#output = new Output({
        format: new WebMOutputFormat({ appendOnly: true }),
        target: new StreamTarget(writable, {
          chunked: true,
          chunkSize: callbackUrl ? NUI_CHUNK_SIZE : HTTP_CHUNK_SIZE,
        }),
      });

      this.#mediaStream = await this.#gameMediaSource.start({
        maxWidth: request.maxWidth,
        maxHeight: request.maxHeight,
        frameRate: 30,
      });
      const videoTrack = this.#mediaStream.getVideoTracks()[0];

      this.#videoSource = new MediaStreamVideoTrackSource(videoTrack, {
        codec: 'vp9',
        bitrate: QUALITY_MEDIUM,
      });

      this.#videoSource.errorPromise.catch((err) => {
        console.error('[screencapture] video encoder error:', err);
      });

      this.#output.addVideoTrack(this.#videoSource);
      await this.#output.start();

      if (request.duration && request.duration > 0) {
        this.#durationTimeout = setTimeout(() => {
          this.stop().catch((err) => {
            console.error('[screencapture] error stopping stream after duration timeout:', err);
          });
        }, request.duration * 1000);
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private createHttpWritableStream(uploadToken: string, serverEndpoint: string): WritableStream<StreamTargetChunk> {
    return new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        const response = await fetch(`${serverEndpoint}/stream-chunk/${uploadToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk.data,
        });

        if (!response.ok) {
          throw new Error(`Chunk upload failed: ${response.status}`);
        }
      },

      async close() {
        await fetch(`${serverEndpoint}/stream-finalize/${uploadToken}`, {
          method: 'POST',
        });
      },
    });
  }

  private createNuiWritableStream(
    uploadToken: string,
    callbackUrl: string,
    finalizeCallbackUrl: string,
  ): WritableStream<StreamTargetChunk> {
    const assertCallbackResponse = this.assertCallbackResponse.bind(this);

    return new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        const bytes = chunk.data instanceof ArrayBuffer
          ? new Uint8Array(chunk.data)
          : new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);

        const BATCH = 8192;
        const parts: string[] = [];
        for (let i = 0; i < bytes.length; i += BATCH) {
          const end = Math.min(i + BATCH, bytes.length);
          parts.push(String.fromCharCode(...bytes.subarray(i, end)));
        }
        const base64Data = btoa(parts.join(''));

        const response = await fetch(callbackUrl, {
          method: 'POST',
          body: JSON.stringify({ token: uploadToken, data: base64Data }),
          headers: { 'Content-Type': 'application/json' },
        });

        await assertCallbackResponse(response, 'NUI chunk callback');
      },

      async close() {
        const response = await fetch(finalizeCallbackUrl, {
          method: 'POST',
          body: JSON.stringify({ token: uploadToken }),
          headers: { 'Content-Type': 'application/json' },
        });

        await assertCallbackResponse(response, 'NUI finalize callback');
      },
    });
  }

  async stop() {
    if (this.#stopping) return;
    this.#stopping = true;

    if (this.#durationTimeout) {
      clearTimeout(this.#durationTimeout);
      this.#durationTimeout = null;
    }

    this.#gameMediaSource.stop();

    if (this.#videoSource) {
      this.#videoSource.close();
    }

    // Flush remaining encoded frames
    if (this.#output && this.#output.state === 'started') {
      try {
        await this.#output.finalize();
      } catch (err) {
        console.error('[screencapture] finalize error:', err);
      }
    }

    this.#output = null;
    this.#videoSource = null;
    this.#mediaStream = null;
    this.#captureId = null;

    if (this.#leaseId) {
      captureSessionCoordinator.release('recording', this.#leaseId);
      this.#leaseId = null;
    }

    this.#stopping = false;
  }
}
