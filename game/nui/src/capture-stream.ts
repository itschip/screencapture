import { createGameView } from '@screencapture/gameview';
import { CaptureStreamActions } from './types';
import { Output, WebMOutputFormat, StreamTarget, MediaStreamVideoTrackSource, QUALITY_MEDIUM } from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';

// Each HTTP POST to the FiveM server must stay under 1 MB.
// 800 KB gives a comfortable margin.
const CHUNK_SIZE = 800 * 1024;

type CaptureStreamRequest = {
  action: CaptureStreamActions;
  uploadToken: string;
  serverEndpoint?: string;
  callbackUrl?: string;
  finalizeCallbackUrl?: string;
  maxWidth?: number;
  maxHeight?: number;
};

export class CaptureStream {
  #gameView: ReturnType<typeof createGameView> | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #output: Output | null = null;
  #videoSource: MediaStreamVideoTrackSource | null = null;
  #mediaStream: MediaStream | null = null;

  start() {
    window.addEventListener('message', async (event) => {
      const data = event.data as CaptureStreamRequest;

      if (data.action === CaptureStreamActions.Start) {
        await this.stream(data);
      }

      if (data.action === CaptureStreamActions.Stop) {
        await this.stop();
      }
    });

    window.addEventListener('resize', () => {
      if (this.#gameView) {
        this.#gameView.resize(window.innerWidth, window.innerHeight);
      }
    });
  }

  private calculateDimensions(request: CaptureStreamRequest): { width: number; height: number } {
    const MAX_WIDTH = 1920;
    const MAX_HEIGHT = 1080;

    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    const maxWidth = request.maxWidth ?? MAX_WIDTH;
    const maxHeight = request.maxHeight ?? MAX_HEIGHT;

    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    const scale = Math.min(maxWidth / originalWidth, maxHeight / originalHeight);
    return {
      width: Math.floor(originalWidth * scale),
      height: Math.floor(originalHeight * scale),
    };
  }

  private waitForFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let waited = 0;
      const tick = () => {
        if (++waited >= count) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async stream(request: CaptureStreamRequest) {
    const { uploadToken, serverEndpoint, callbackUrl, finalizeCallbackUrl } = request;
    const { width, height } = this.calculateDimensions(request);

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = width;
    this.#canvas.height = height;

    this.#gameView = createGameView(this.#canvas);
    this.#gameView.resize(width, height);

    // Wait for the FiveM WebGL hook to populate the game framebuffer
    await this.waitForFrames(3);

    const writable = callbackUrl
      ? this.createNuiWritableStream(uploadToken, callbackUrl, finalizeCallbackUrl!)
      : this.createHttpWritableStream(uploadToken, serverEndpoint!);

    this.#output = new Output({
      format: new WebMOutputFormat({ appendOnly: true }),
      target: new StreamTarget(writable, { chunked: true, chunkSize: CHUNK_SIZE }),
    });

    // canvas.captureStream() is the reliable way to read a desynchronized WebGL
    // canvas in Chromium. VideoFrame(canvas) can lag or produce empty frames
    // when the context was created with desynchronized:true, which createGameView
    // uses. captureStream() routes through the browser's internal compositing
    // path and always delivers the latest rendered frame.
    this.#mediaStream = this.#canvas.captureStream(30);
    const videoTrack = this.#mediaStream.getVideoTracks()[0];

    this.#videoSource = new MediaStreamVideoTrackSource(videoTrack, {
      codec: 'vp9',
      bitrate: QUALITY_MEDIUM,
    });

    // Surface any encoder-level errors so they show up in the NUI console
    this.#videoSource.errorPromise.catch((err) => {
      console.error('[screencapture] video encoder error:', err);
    });

    this.#output.addVideoTrack(this.#videoSource);
    // Frame capture starts automatically once the output is started — no loop needed
    await this.#output.start();
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
    return new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        // Convert binary chunk to base64 for NUI callback transport
        const bytes = chunk.data instanceof ArrayBuffer
          ? new Uint8Array(chunk.data)
          : new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        const response = await fetch(callbackUrl, {
          method: 'POST',
          body: JSON.stringify({ token: uploadToken, data: base64Data }),
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`NUI chunk callback failed: ${response.status}`);
        }
      },

      async close() {
        await fetch(finalizeCallbackUrl, {
          method: 'POST',
          body: JSON.stringify({ token: uploadToken }),
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
  }

  async stop() {
    // Stop all media tracks so no new frames are delivered to the source
    if (this.#mediaStream) {
      for (const track of this.#mediaStream.getTracks()) {
        track.stop();
      }
    }

    // Signal mediabunny that this track has no more data coming
    if (this.#videoSource) {
      this.#videoSource.close();
    }

    // Flush remaining encoded frames → StreamTarget write() POSTs final chunks
    // → StreamTarget close() POSTs /stream-finalize to the server
    if (this.#output && this.#output.state === 'started') {
      try {
        await this.#output.finalize();
      } catch (err) {
        console.error('[screencapture] finalize error:', err);
      }
    }

    if (this.#gameView) {
      this.#gameView.dispose();
      this.#gameView = null;
    }

    if (this.#canvas) {
      this.#canvas.remove();
      this.#canvas = null;
    }

    this.#output = null;
    this.#videoSource = null;
    this.#mediaStream = null;
  }
}
