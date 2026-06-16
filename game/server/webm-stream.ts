// NEW FILE — live WebM relay framing.
//
// A relay stream (startVideoStream) does not write to disk. Instead the continuous
// appendOnly-WebM byte stream produced by the NUI is split here into MSE-appendable
// segments and handed to the caller's onSegment callback in real time:
//
//   - one 'init' segment  = EBML header + Segment + Tracks (everything before the
//                           first Cluster). Append once into an MSE SourceBuffer.
//   - one 'media' segment  = one full WebM Cluster. Append sequentially.
//
// Segment boundaries are the Cluster element ID (0x1F43B675). Network chunk
// boundaries are irrelevant: bytes are accumulated until a full segment is ready.

import { StreamUploadData, StreamSegment } from './types';

const CLUSTER_ID = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

function emit(stream: StreamUploadData, type: StreamSegment['type'], bytes: Buffer): void {
  if (!stream.onSegment || bytes.length === 0) return;
  const seq = stream.segSeq ?? 0;
  stream.segSeq = seq + 1;
  stream.onSegment({
    captureId: stream.captureId,
    source: stream.source,
    type,
    seq,
    data: bytes.toString('base64'),
  });
}

// Feed newly received bytes; emits the init segment and every complete Cluster.
export function feedStream(stream: StreamUploadData, incoming: Buffer): void {
  if (!stream.onSegment) return;
  stream.pending = stream.pending ? Buffer.concat([stream.pending, incoming]) : incoming;

  // Emit the init segment once, as soon as the first Cluster begins.
  if (!stream.initSent) {
    const first = stream.pending.indexOf(CLUSTER_ID);
    if (first === -1) return; // header not fully received yet
    emit(stream, 'init', stream.pending.subarray(0, first));
    stream.initSent = true;
    stream.pending = stream.pending.subarray(first); // pending now starts at a Cluster
  }

  // pending begins at a Cluster ID — cut a 'media' segment each time the next one starts.
  for (;;) {
    const next = stream.pending.indexOf(CLUSTER_ID, 4); // skip this cluster's own ID
    if (next === -1) break; // current Cluster not finished yet
    emit(stream, 'media', stream.pending.subarray(0, next));
    stream.pending = stream.pending.subarray(next);
  }
}

// Flush the trailing Cluster when the capture stops.
export function flushStream(stream: StreamUploadData): void {
  if (stream.onSegment && stream.pending && stream.pending.length > 0) {
    emit(stream, stream.initSent ? 'media' : 'init', stream.pending);
  }
  stream.pending = Buffer.alloc(0);
}
