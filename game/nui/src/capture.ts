import { createGameView } from '@screencapture/gameview';

type Encoding = 'webp' | 'jpg' | 'png';

type CaptureRequest = {
  action: 'capture';
  url: string;
  encoding: Encoding;
  quality: number;
  headers: Headers;
  uploadToken: string;

  serverEndpoint?: string;
  // only used for screenshot-basic requestScreenshot export
  callbackUrl?: string;
  correlationId?: string;
  formField: string;
  dataType: 'blob' | 'base64';
  maxWidth?: number;
  maxHeight?: number;
};

export class Capture {
  #gameView: any;
  #canvas: HTMLCanvasElement | null = null;
  #queue: Promise<void> = Promise.resolve();

  private readonly MAX_WIDTH = 1920;
  private readonly MAX_HEIGHT = 1080;

  start() {
    window.addEventListener('message', (event) => {
      const data = event.data as CaptureRequest;

      if (data.action === 'capture') {
        this.#queue = this.#queue.then(() => this.captureScreen(data)).catch((err) => {
          console.error('[screencapture] capture error:', err);
        });
      }
    });

    window.addEventListener('resize', () => {
      if (this.#gameView) {
        this.#gameView.resize(window.innerWidth, window.innerHeight);
      }
    });
  }

  private calculateDimensions(request: CaptureRequest): { width: number; height: number } {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    const maxWidth = request.maxWidth || this.MAX_WIDTH;
    const maxHeight = request.maxHeight || this.MAX_HEIGHT;

    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    const scaleX = maxWidth / originalWidth;
    const scaleY = maxHeight / originalHeight;
    const scale = Math.min(scaleX, scaleY);

    return {
      width: Math.floor(originalWidth * scale),
      height: Math.floor(originalHeight * scale),
    };
  }

  async captureScreen(request: CaptureRequest) {
    this.#canvas = document.createElement('canvas');

    const { width, height } = this.calculateDimensions(request);
    this.#canvas.width = width;
    this.#canvas.height = height;

    this.#gameView = createGameView(this.#canvas);
    this.#gameView.resize(width, height);

    try {
      // Wait for the FiveM WebGL hook to populate the game framebuffer
      await this.waitForFrames(3);

      const enc = request.encoding ?? 'png';
      let imageData: string | Blob;
      // callbackUrl is only set on the screenshot-basic requestScreenshot path;
      // everything else is handled server-side via the upload endpoint
      if (request.callbackUrl) {
        imageData = await this.createDataURL(this.#canvas, enc, request.quality);
      } else {
        imageData = await this.createBlob(this.#canvas, enc, request.quality);
      }

      if (!imageData) return console.error('No image available');

      await this.httpUploadImage(request, imageData);
    } finally {
      this.#gameView.dispose();
      this.#canvas.remove();
      this.#gameView = null;
      this.#canvas = null;
    }
  }

  async httpUploadImage(request: CaptureRequest, imageData: string | Blob) {
    const reqBody = this.createRequestBody(request, imageData);

    if (request.callbackUrl) {
      try {
        await fetch(request.callbackUrl, {
          method: 'POST',
          mode: 'cors',
          body: reqBody,
        });
      } catch (err) {
        console.error(err);
      }

      return;
    }

    if (request.serverEndpoint) {
      try {
        await fetch(`${request.serverEndpoint}/${request.uploadToken}`, {
          method: 'POST',
          mode: 'cors',
          body: reqBody,
        });
      } catch (err) {
        console.error(err);
      }
    }
  }

  createRequestBody(request: CaptureRequest, imageData: string | Blob): BodyInit {
    if (imageData instanceof Blob) {
      const formData = new FormData();
      formData.append('file', imageData);
      return formData;
    }

    return JSON.stringify({ data: imageData, id: request.correlationId, uploadToken: request.uploadToken });
  }

  createDataURL(canvas: HTMLCanvasElement, enc: Encoding, requestQuality?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = canvas.toDataURL(`image/${enc}`, requestQuality);
      if (!url) {
        reject('No data URL available');
      }

      resolve(url);
    });
  }

  createBlob(canvas: HTMLCanvasElement, enc: Encoding, requestQuality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const pixelCount = canvas.width * canvas.height;
      let quality = 0.7;

      if (requestQuality) {
        quality = requestQuality;
      } else {
        // Scale quality down for high-resolution captures to keep payload size reasonable
        if (pixelCount > 2073600) {
          // > 1920×1080
          quality = 0.5;
        } else if (pixelCount > 1440000) {
          // > 1200×1200
          quality = 0.6;
        }
      }

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject('No blob available');
          }
        },
        `image/${enc}`,
        quality,
      );
    });
  }

  private waitForFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      let framesWaited = 0;
      const waitFrame = () => {
        framesWaited++;
        if (framesWaited >= count) {
          resolve();
        } else {
          requestAnimationFrame(waitFrame);
        }
      };
      requestAnimationFrame(waitFrame);
    });
  }
}
