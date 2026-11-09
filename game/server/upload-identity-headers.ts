const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return headers as Record<string, string>;
}

function isUploadIdentityHeadersEnabled(): boolean {
  const value = GetConvar('screencapture_upload_identity_headers', 'true').trim().toLowerCase();
  return !DISABLED_VALUES.has(value);
}

export function getUploadHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function formatUploadErrorMessage(kind: 'image' | 'video', url: string, err: unknown): string {
  const host = getUploadHost(url) ?? 'unknown host';
  const httpStatus =
    err && typeof err === 'object' && typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
      ? (err as { httpStatus: number }).httpStatus
      : undefined;
  if (httpStatus) return `${kind} upload failed to ${host} with HTTP ${httpStatus}`;

  const code =
    err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : undefined;
  return `${kind} upload failed to ${host}${code ? ` (${code})` : ''}`;
}

function getServerName(): string | undefined {
  const projectName = toHeaderValue(GetConvar('sv_projectName', ''));
  if (projectName) return projectName;

  const hostname = toHeaderValue(GetConvar('sv_hostname', ''));
  return hostname || undefined;
}

// Server names often contain emoji or symbols, which Node rejects in header
// values with ERR_INVALID_CHAR and fails the whole upload.
function toHeaderValue(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createUploadHeaders(url: string, headers?: HeadersInit): Record<string, string> {
  const customHeaders = normalizeHeaders(headers);
  if (!isUploadIdentityHeadersEnabled()) return customHeaders;

  const resourceName = GetCurrentResourceName();
  const resourceVersion = GetResourceMetadata(resourceName, 'version', 0) || 'unknown';
  const serverName = getServerName();
  const uploadHost = getUploadHost(url);

  return {
    'User-Agent': `screencapture/${resourceVersion}`,
    ...(serverName && { 'X-Screencapture-Server-Name': serverName }),
    ...(uploadHost && { 'X-Screencapture-Upload-Host': uploadHost }),
    'X-Screencapture-Resource': resourceName,
    ...customHeaders,
  };
}
