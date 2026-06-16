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

Stops an active recording by `captureId`. This triggers `output.finalize()` in the NUI, flushes remaining encoded frames, and fires the callback registered by `startVideoCapture`, `startVideoCaptureUpload`, or `startVideoStream`.

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

### `startVideoStream` — server-side export

Starts a **continuous** video capture and relays the live WebM stream to your `onSegment` callback as MSE-appendable segments — one `init` segment followed by one `media` segment per WebM Cluster — instead of assembling a file. Nothing is written to disk. Pair it with [MediaSource Extensions](https://developer.mozilla.org/docs/Web/API/Media_Source_Extensions_API) on the receiving end for gap-free, low-latency live playback. Returns a `captureId`; stop it with `stopVideoCapture` (or pass `duration`).

| Parameter   | Type       | Description                                            |
| ----------- | ---------- | ------------------------------------------------------ |
| `source`    | `number`   | Player source to record                                |
| `options`   | `object`   | Capture options (see below)                            |
| `onSegment` | `function` | Called for every segment as it is produced             |
| `callback`  | `function` | Optional. Called with the result when the stream ends  |

#### Options

| Field             | Type     | Default  | Description                                                               |
| ----------------- | -------- | -------- | ------------------------------------------------------------------------- |
| `duration`        | `number` |          | Optional recording duration in seconds                                    |
| `maxWidth`        | `number` | `1920`   | Maximum capture width in pixels                                           |
| `maxHeight`       | `number` | `1080`   | Maximum capture height in pixels                                          |
| `streamChunkSize` | `number` | `819200` | WebM output chunk size in bytes — smaller = lower latency, more requests  |

Each `onSegment` call receives an object:

| Field       | Type                  | Description                                                      |
| ----------- | --------------------- | --------------------------------------------------------------- |
| `captureId` | `string`              | The capture this segment belongs to                             |
| `source`    | `number`              | Player source                                                   |
| `type`      | `'init'` \| `'media'` | `'init'` = header/Tracks (append once); `'media'` = one Cluster |
| `seq`       | `number`              | Monotonic sequence number per stream                            |
| `data`      | `string`              | Base64 of the WebM bytes                                        |

```lua
local captureId = exports.screencapture:startVideoStream(source, {
    maxWidth = 1280,
    maxHeight = 720,
    streamChunkSize = 48 * 1024,
}, function(segment)
    -- segment.type == 'init'  → append once into an MSE SourceBuffer
    -- segment.type == 'media' → append in seq order (one WebM Cluster)
    -- segment.data is base64-encoded WebM
    relayToViewers(segment)
end, function(result)
    print(('Stream %s ended (%d bytes)'):format(result.captureId, result.bytesReceived or 0))
end)

-- Stop later.
exports.screencapture:stopVideoCapture(captureId)
```

```ts
const captureId = exports.screencapture.startVideoStream(
  source,
  { maxWidth: 1280, maxHeight: 720, streamChunkSize: 48 * 1024 },
  (segment: { captureId: string; source: number; type: 'init' | 'media'; seq: number; data: string }) => {
    // 'init' → append once into an MSE SourceBuffer; 'media' → append in seq order.
    // segment.data is base64-encoded WebM.
    relayToViewers(segment);
  },
  (result: any) => {
    console.log(`Stream ${result.captureId} ended`);
  },
);
```

> Late joiners need the cached `init` segment re-sent before live `media` segments; the receiver is responsible for caching/forwarding them.

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
