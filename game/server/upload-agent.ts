import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const httpAgent = new HttpAgent({ family: 4 });
const httpsAgent = new HttpsAgent({ family: 4 });

function selectIpv4Agent(url: URL): HttpAgent | HttpsAgent {
  return url.protocol === 'https:' ? httpsAgent : httpAgent;
}

export function getUploadAgent(): typeof selectIpv4Agent | undefined {
  const value = GetConvar('screencapture_upload_ipv4', 'false').trim().toLowerCase();
  return ENABLED_VALUES.has(value) ? selectIpv4Agent : undefined;
}
