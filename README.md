# ScreenCapture

A FiveM resource for capturing screenshots and recording videos from a player's game view, built as a modern replacement for screenshot-basic.

---

## Screenshots

### `serverCapture` — server-side export

Captures a screenshot for a player and returns the image data to your callback.

| Parameter  | Type                   | Description                                                    |
| ---------- | ---------------------- | -------------------------------------------------------------- |
| `source`   | `number`               | Player source to capture                                       |
| `options`  | `object`               | Capture options (see below)                                    |
| `callback` | `function`             | Called with the captured image data                            |
| `dataType` | `'base64'` \| `'blob'` | Format of the data passed to the callback. Default: `'base64'` |

#### Options

| Field       | Type     | Default  | Description                                          |
| ----------- | -------- | -------- | ---------------------------------------------------- |
| `encoding`  | `string` | `'webp'` | Image encoding format: `'webp'`, `'jpg'`, or `'png'` |
| `maxWidth`  | `number` | `1920`   | Maximum capture width in pixels                      |
| `maxHeight` | `number` | `1080`   | Maximum capture height in pixels                     |

```lua
exports.screencapture:serverCapture(source, { encoding = 'webp' }, function(data)
    -- data is a base64 data URI string
    print(data)
end)
```

```ts
exports.screencapture.serverCapture(
  source,
  { encoding: 'webp' },
  (data: Buffer) => {
    fs.writeFileSync('./screenshot.webp', data);
  },
  'blob',
);
```

---

### `remoteUpload` — server-side export

Captures a screenshot and uploads it directly to a remote URL. The callback receives the remote API's JSON response.

| Parameter  | Type                   | Description                                |
| ---------- | ---------------------- | ------------------------------------------ |
| `source`   | `number`               | Player source to capture                   |
| `url`      | `string`               | Remote upload URL                          |
| `options`  | `object`               | Capture options (see below)                |
| `callback` | `function`             | Called with the remote API's JSON response |
| `dataType` | `'base64'` \| `'blob'` | Upload format. Default: `'base64'`         |

#### Options

| Field       | Type     | Default  | Description                                          |
| ----------- | -------- | -------- | ---------------------------------------------------- |
| `encoding`  | `string` | `'webp'` | Image encoding format: `'webp'`, `'jpg'`, or `'png'` |
| `headers`   | `object` | `{}`     | HTTP headers included in the upload request          |
| `formField` | `string` | `'file'` | FormData field name for the uploaded file            |
| `filename`  | `string` |          | File name used in the FormData (without extension)   |
| `maxWidth`  | `number` | `1920`   | Maximum capture width in pixels                      |
| `maxHeight` | `number` | `1080`   | Maximum capture height in pixels                     |

Remote uploads include server identity headers by default: `User-Agent`, `X-Screencapture-Server-Name`, `X-Screencapture-Upload-Host`, and `X-Screencapture-Resource`. These expose the FiveM server name and resource name to the upload provider. Set `screencapture_upload_identity_headers false` in your server config to disable them. User-provided `headers` override the defaults.

For servers with unreliable IPv6 connectivity, add `set screencapture_upload_ipv4 true` to `server.cfg` to force IPv4 for remote screenshot and video uploads. The default is `false`, which keeps Node.js address selection. The setting is read for each upload.

```lua
exports.screencapture:remoteUpload(source, 'https://api.fivemanage.com/api/v3/file', {
    encoding = 'webp',
    headers = { ['Authorization'] = 'your-api-key' },
}, function(response)
    print(response.data.url)
end, 'blob')
```

```ts
exports.screencapture.remoteUpload(
  source,
  'https://api.fivemanage.com/api/v3/file',
  {
    encoding: 'webp',
    headers: { Authorization: 'your-api-key' },
  },
  (response: any) => {
    console.log(response.data.url);
  },
  'blob',
);
```

---

## Video capture

> **Experimental.** Video capture is functional but has not been extensively tested across different hardware, FiveM builds, or CEF versions. The API may change. VP9 encoding relies on the WebCodecs API being available in FiveM's bundled Chromium — if encoding silently produces no frames, the resulting file will contain only the container header. Please report any issues.

Video is recorded as WebM (VP9) via the player's NUI. Chunks are streamed to the server as they are produced, assembled on disk, and the callback is fired when the recording is finalized.

Every video capture returns a public `captureId`. Use it to stop the recording, check whether it is active, and correlate callback results. Internal upload tokens are not part of the public API.

---

### `startVideoCapture` — server-side export

Starts a video recording for a player and returns a `captureId`. If `duration` is provided, the recording stops automatically after that many seconds. The callback receives a structured result object when the WebM file is finalized. The file lives in `screencapture/tmp/` and the caller is responsible for it.

| Parameter  | Type       | Description                              |
| ---------- | ---------- | ---------------------------------------- |
| `source`   | `number`   | Player source to record                  |
| `options`  | `object`   | Capture options (see below)              |
| `callback` | `function` | Called with the finalized capture result |

#### Options

| Field       | Type     | Default | Description                                      |
| ----------- | -------- | ------- | ------------------------------------------------ |
| `duration`  | `number` |         | Optional recording duration in seconds           |
| `maxWidth`  | `number` | `1920`  | Maximum capture width in pixels                  |
| `maxHeight` | `number` | `1080`  | Maximum capture height in pixels                 |

```lua
local captureId = exports.screencapture:startVideoCapture(source, {
    duration = 10,
    maxWidth = 1280,
    maxHeight = 720,
}, function(result)
    if result.status ~= 'success' then
        print(('Video capture failed: %s'):format(result.error or 'unknown error'))
        return
    end

    print(('Capture %s saved to %s'):format(result.captureId, result.filePath))
    print(('Bytes received: %d'):format(result.bytesReceived or 0))
end)

print(('Started video capture: %s'):format(captureId))
```

```ts
const captureId = exports.screencapture.startVideoCapture(
  source,
  { duration: 10, maxWidth: 1280, maxHeight: 720 },
  (result: any) => {
    if (result.status !== 'success') {
      console.error('Video capture failed:', result.error);
      return;
    }

    console.log(`Capture ${result.captureId} saved to ${result.filePath}`);
  },
);
```

---

### `stopVideoCapture` — server-side export

Stops an active recording by `captureId`. This triggers `output.finalize()` in the NUI, flushes remaining encoded frames, and fires the callback registered by `startVideoCapture` or `startVideoCaptureUpload`.

| Parameter   | Type     | Description              |
| ----------- | -------- | ------------------------ |
| `captureId` | `string` | Capture ID to stop       |

```lua
local captureId = exports.screencapture:startVideoCapture(source, {}, function(result)
    print(result.filePath)
end)

-- Stop later.
exports.screencapture:stopVideoCapture(captureId)
```

---

### `startVideoCaptureUpload` — server-side export

Starts a video recording for a player, uploads the resulting WebM to a remote URL when finalized, deletes the temp file, and returns a `captureId`. The callback receives a structured result object with the remote response.

| Parameter  | Type       | Description                              |
| ---------- | ---------- | ---------------------------------------- |
| `source`   | `number`   | Player source to record                  |
| `url`      | `string`   | Remote upload URL                        |
| `options`  | `object`   | Upload and capture options               |
| `callback` | `function` | Called with the finalized capture result |

#### Options

| Field       | Type     | Default       | Description                                     |
| ----------- | -------- | ------------- | ----------------------------------------------- |
| `duration`  | `number` |               | Optional recording duration in seconds          |
| `headers`   | `object` | `{}`          | HTTP headers included in the upload request     |
| `formField` | `string` | `'file'`      | FormData field name for the uploaded file       |
| `filename`  | `string` | `'recording'` | File name in the FormData (`.webm` is appended) |
| `maxWidth`  | `number` | `1920`        | Maximum capture width in pixels                 |
| `maxHeight` | `number` | `1080`        | Maximum capture height in pixels                |

Remote video uploads use the same server identity headers and `screencapture_upload_identity_headers` opt-out as screenshot uploads.

```lua
local captureId = exports.screencapture:startVideoCaptureUpload(source, 'https://api.fivemanage.com/api/v3/file', {
    duration = 15,
    headers = { ['Authorization'] = 'your-api-key' },
    filename = 'gameplay',
}, function(result)
    if result.status ~= 'success' then
        print(('Upload failed: %s'):format(result.error or 'unknown error'))
        return
    end

    print(('Uploaded capture %s'):format(result.captureId))
    print(result.response.data.url)
end)
```

---

### `isVideoCaptureActive` — server-side export

Returns whether a capture ID is currently active.

```lua
if exports.screencapture:isVideoCaptureActive(captureId) then
    exports.screencapture:stopVideoCapture(captureId)
end
```

---

### Compatibility exports

`serverCaptureStream`, `remoteUploadStream`, `INTERNAL_stopServerCaptureStream`, and `stopStream` are still available for existing callers. The stream start exports now return a `captureId`, but their callbacks keep the old payloads: local captures receive the WebM file path, and remote captures receive the remote API response.

```lua
local captureId = exports.screencapture:serverCaptureStream(source, { duration = 10 }, function(filePath)
    print(filePath)
end)

exports.screencapture:INTERNAL_stopServerCaptureStream(source)
```

---

## Live streaming

Live streaming publishes one player's game view to Cloudflare Realtime SFU and allows multiple admin-panel viewers to subscribe through `@screencapture/live`. Video does not travel through FiveM latent events. The player always sees a persistent streaming indicator.

Live streaming is capped at 1280x720, 30 FPS, 25 viewers, and 30 minutes. Game-output audio is not exposed by the supported FiveM game-view API, so the current publisher reports `audioAvailable = false` and continues video-only. Microphone capture is never used.

### Service setup

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/itschip/screencapture/tree/main/workers/live)

The button prompts for your Realtime App ID and App Secret. Cloudflare deploys the Worker and automatically provisions its SQLite Durable Object. After it finishes, copy the deployed Worker URL into `screencapture_live_endpoint` as shown below.

For manual deployment:

1. Create a Cloudflare Realtime SFU app and copy its App ID and App Secret.
2. Configure both credentials as Worker secrets and deploy from the resource root:

```cmd
pnpm install
pnpm types:live-worker
pnpm --filter @screencapture/live-worker exec wrangler secret put CALLS_APP_ID
pnpm --filter @screencapture/live-worker exec wrangler secret put CALLS_APP_SECRET
pnpm deploy:live-worker
```

3. Point the FiveM resource at the deployed HTTPS Worker:

```cfg
set screencapture_live_endpoint "https://screencapture-live.<account>.workers.dev"
```

### Server exports

```lua
local streamId = exports.screencapture:startLiveStream(source, {
  duration = 900,
  maxWidth = 1280,
  maxHeight = 720,
  frameRate = 30,
  maxViewers = 25,
}, function(result)
  if result.status == 'error' then
    print(('Live stream failed: %s'):format(result.error))
    return
  end

  print(('Live stream %s is ready'):format(result.streamId))
end)
```

Issue a short-lived, one-time viewer grant only after your own admin backend has authorized the viewer:

```lua
exports.screencapture:createLiveStreamViewerToken(streamId, function(grant)
  if grant.error then
    print(grant.error)
    return
  end

  -- Deliver grant.streamId and grant.viewerToken to the authorized admin.
end)
```

Use `stopLiveStream(streamId)`, `isLiveStreamActive(streamId)`, and the server event `screencapture:liveStreamEnded` for lifecycle management. A player cannot record WebM and publish live video simultaneously.

### Browser viewer

```ts
import { ScreenCaptureViewer } from '@screencapture/live';

const viewer = new ScreenCaptureViewer({
  endpoint: liveServiceEndpoint,
  streamId: grant.streamId,
  viewerToken: grant.viewerToken,
});

await viewer.connect();
await viewer.attach(document.querySelector('video')!);
await viewer.setQuality('auto');
```

The SDK also exposes `getStats()`, `disconnect()`, and typed `state`, `track`, and `error` listeners. Viewer tokens and owner capabilities must not be placed in URLs or logs. This repository does not provide an admin panel, account system, or creator authentication layer.

---

## Screenshot-basic compatibility

### `requestScreenshotUpload` — client-side export

> **Not recommended.** Upload tokens are exposed to the client.

```lua
exports['screencapture']:requestScreenshotUpload('https://api.fivemanage.com/api/v3/file', 'file', {
    headers = { ['Authorization'] = 'your-api-key' },
    encoding = 'webp',
}, function(data)
    local resp = json.decode(data)
    print(resp.url)
end)
```

### `requestScreenshot` — client-side export

Returns a base64 data URI of the screenshot directly to the callback without uploading.

```lua
exports['screencapture']:requestScreenshot({ encoding = 'jpg' }, function(data)
    -- data is a base64-encoded image data URI
    print(data)
end)
```
