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

Video is recorded as WebM (VP9) via the player's NUI. Chunks are streamed to the server as they are produced, assembled on disk, and the callback is fired when the recording is stopped and finalized.

Use `INTERNAL_stopServerCaptureStream` to stop an active recording — it works for both `serverCaptureStream` and `remoteUploadStream`.

---

### `serverCaptureStream` — server-side export

Starts a video recording for a player. When stopped, the assembled WebM file path is passed to the callback. The file lives in `screencapture/tmp/` and the caller is responsible for it.

| Parameter  | Type       | Description                                              |
| ---------- | ---------- | -------------------------------------------------------- |
| `source`   | `number`   | Player source to record                                  |
| `options`  | `object`   | Capture options (see below)                              |
| `callback` | `function` | Called with the WebM file path (`string`) when finalized |

#### Options

| Field       | Type     | Default | Description                      |
| ----------- | -------- | ------- | -------------------------------- |
| `maxWidth`  | `number` | `1920`  | Maximum capture width in pixels  |
| `maxHeight` | `number` | `1080`  | Maximum capture height in pixels |

```lua
exports.screencapture:serverCaptureStream(source, {}, function(filePath)
    local f = io.open(filePath, 'rb')
    if f then
        local size = f:seek('end')
        f:close()
        print(('Recorded %d bytes (%.2f MB)'):format(size, size / 1024 / 1024))
    end
end)
```

```ts
exports.screencapture.serverCaptureStream(source, {}, (filePath: string) => {
  const data = fs.readFileSync(filePath);
  fs.writeFileSync('./recording.webm', data);
  fs.unlinkSync(filePath); // clean up the temp file
});
```

---

### `remoteUploadStream` — server-side export

Starts a video recording for a player and uploads the resulting WebM to a remote URL when stopped. The callback receives the remote API's JSON response. The temp file is deleted automatically after upload.

| Parameter  | Type       | Description                                |
| ---------- | ---------- | ------------------------------------------ |
| `source`   | `number`   | Player source to record                    |
| `url`      | `string`   | Remote upload URL                          |
| `options`  | `object`   | Upload options (see below)                 |
| `callback` | `function` | Called with the remote API's JSON response |

#### Options

| Field       | Type     | Default       | Description                                     |
| ----------- | -------- | ------------- | ----------------------------------------------- |
| `headers`   | `object` | `{}`          | HTTP headers included in the upload request     |
| `formField` | `string` | `'file'`      | FormData field name for the uploaded file       |
| `filename`  | `string` | `'recording'` | File name in the FormData (`.webm` is appended) |
| `maxWidth`  | `number` | `1920`        | Maximum capture width in pixels                 |
| `maxHeight` | `number` | `1080`        | Maximum capture height in pixels                |

```lua
exports.screencapture:remoteUploadStream(source, 'https://api.fivemanage.com/api/v3/file', {
    headers = { ['Authorization'] = 'your-api-key' },
    filename = 'gameplay',
}, function(response)
    print(response.data.url)
end)
```

```ts
exports.screencapture.remoteUploadStream(
  source,
  'https://api.fivemanage.com/api/v3/file',
  {
    headers: { Authorization: 'your-api-key' },
    filename: 'gameplay',
  },
  (response: any) => {
    console.log(response.data.url);
  },
);
```

---

### `INTERNAL_stopServerCaptureStream` — server-side export

Stops the active recording for a player. Triggers `output.finalize()` in the NUI which flushes remaining encoded frames, then fires the callback registered by `serverCaptureStream` or `remoteUploadStream`.

| Parameter | Type     | Description                           |
| --------- | -------- | ------------------------------------- |
| `source`  | `number` | Player source whose recording to stop |

```lua
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
