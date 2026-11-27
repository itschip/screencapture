// Limits include base64 encoding and the data URL prefix.
export const IMAGE_CHUNK_BYTES = 256 * 1024;
export const MAX_IMAGE_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_CHUNKS = MAX_IMAGE_UPLOAD_BYTES / IMAGE_CHUNK_BYTES;
