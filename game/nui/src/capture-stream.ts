import { createGameView } from '@screencapture/gameview';
import { CaptureStreamActions } from './types';

type CaptureStreamRequest = {
  action: CaptureStreamActions;
  url: string;
  headers: Headers;
  uploadToken: string;
  serverEndpoint: string;
  formField: string;
};

export class CaptureStream {
  #gameView: any;
  #canvas: HTMLCanvasElement | null = null;
  #mediaStream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];

  start() {
    window.addEventListener('message', (event) => {
      const data = event.data as CaptureStreamRequest;

      if (data.action === CaptureStreamActions.Start) {
        console.log('got message to start streaming');
        this.stream(data);
      }

      if (data.action === CaptureStreamActions.Stop) {
        this.stop();
      }
    });

    window.addEventListener('resize', () => {
      if (this.#gameView) {
        this.#gameView.resize(window.innerWidth, window.innerHeight);
      }
    });
  }

  stream(request: CaptureStreamRequest) {
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = window.innerWidth;
    this.#canvas.height = window.innerHeight;

    this.#gameView = createGameView(this.#canvas);

    if (!this.#canvas) return console.error('Failed to find canvas');

    this.#mediaStream = this.#canvas.captureStream(30);
    this.#recorder = new MediaRecorder(this.#mediaStream, { mimeType: 'video/webm' });

    this.#recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) {
        console.log('data size', ev.data.size);
        this.#chunks.push(ev.data);
        // send chunk to http handler with corrID
      }
    };

    this.#recorder.onerror = (err) => {
      console.error('oops', err);
    };

    this.#recorder.onstop = async () => {
      console.log('rec stop');
      await this.uploadVideo(request);
      if (this.#canvas) return this.#canvas.remove();
    };

    this.#recorder.start(500);
  }

  stop() {
    if (this.#recorder && this.#recorder.state !== 'inactive') {
      this.#recorder.stop();

      if (this.#canvas) {
        this.#canvas?.remove();
      }
    }
  }

  async uploadVideo(request: CaptureStreamRequest) {
    console.log('chunk len', this.#chunks.length);

    const blob = new Blob(this.#chunks, { type: this.#recorder?.mimeType });
    console.log('blob size', blob.size);

    if (blob.size === 0) {
      console.error('Blob is empty, skipping upload');
      return;
    }

    const formData = new FormData();
    formData.append(request.formField || 'file', blob, 'capture.webm');

    console.log('request', request);

    try {
      // Fetch without setting 'Content-Type' manually
      const response = await fetch(`${request.serverEndpoint}/${request.uploadToken}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload video. Status: ${response.status}`);
      }

      console.log('Video uploaded successfully');
    } catch (err) {
      console.error('Error uploading video', err);
    }
  }
}
