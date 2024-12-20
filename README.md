# ScreenCapture (WIP)

ScreenCapture is a being built as a replacement for screenshot-basic in FiveM.

## Why build something new?

I'll explain this later, but breifly - Screenshot-Basic is no longer maintained, has it's issues. It's a nightmare for almost everyone to get up and running for some reason (blame FXServer yarn) and it's not up-to-date with anything.

## How to use

ScreenCapture is still WIP, but you are able to the minimum if you're using Node.js. Note that there's only server-side exports at the moment. I might add client exports, but only if there's enough requests for it. There will also be an export that will upload through NUI, even though this might be redundant - we'll see.

### JavaScript / TypeScript

Converting Base64 to Blob/Buffer is easy enough with Node, but Lua ScRT in FiveM doesn't really offer that functionality, so if you wish to use the `serverCapture` export, you'll need to use Base64. More on that later.

### serverCapture (server-side export)

| Parameter  | Type                     | Description                                                               |
|------------|--------------------------|---------------------------------------------------------------------------|
| `source`   | string                   | Player to capture                                                         |
| `options`  | object/table             | Configuration options for the capture                                     |
| `callback` | function                 | A function invoked with the captured data                                 |
| `dataType` | string (default: base64) | What data should be returned through the callback: `'base64'` or `'blob'` |

#### Options

The `options` argument accepts an object with the following fields:

| Field        | Type            | Default  | Description                                                              |
|--------------|-----------------|----------|--------------------------------------------------------------------------|
| `headers`    | `object/table`  | `null`   | Optional HTTP headers to include in the capture request.                 |
| `formField`  | `string`        | `null`   | The form field name to be used when uploading the captured data.         |
| `filename`   | `string`        | `null`   | Specifies the name of the file when saving or transmitting captured data.|
| `encoding`   | `string`        | `'webp'` | Specifies the encoding format for the captured image (e.g., `'webp'`).   |


```ts
RegisterCommand(
  'capture',
  (_: string, args: string[]) => {
    exp.screencapture.serverCapture(
      args[0],
      { encoding: 'webp' },
      (data: string | Buffer<ArrayBuffer>) => {
        data = Buffer.from(data as ArrayBuffer);

        fs.writeFileSync('./blob_image.webp', data);
        console.log(`File saved`);
      },
      'blob',
    );
  },
  false,
);
```

```ts
RegisterCommand("remoteCapture", (_: string, args: string[]) => {
  exp.screencapture.remoteUpload(args[0], "https://api.fivemanage.com/api/image", {
    encoding: "webp",
    headers: {
      "Authorization": "",
    }
  }, (data: any) => {
    console.log(data);
  }, "blob")
}, false);
```

## What will this include?
1. Server exports both for getting image data and uploading images/videos from the server
2. Client exports
3. Upload images or videos from NUI, just more secure.
4. React, Svelt and Vue packages + publishing all internal packages like @screencapture/gameview (SoonTM)