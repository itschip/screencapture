---
title: Configuration
description: Configure capture protocol and latent event bandwidth settings.
---

`fxmanifest.lua` controls the capture transport and latent event bandwidth. The resource uses `fx_version 'cerulean'`.

```lua
provide 'screenshot-basic'

-- use 'https' with screencapture_https_endpoint for an HTTPS reverse proxy
protocol 'nui'

-- bytes per second for latent image and stream transfers
images_bps '500000'
stream_bps '5000000'
```

## Protocols

| Protocol | Description |
| --- | --- |
| `nui` | Default. Uses HTTPS NUI callbacks and latent server events. No public upload endpoint is required. |
| `https` | Sends captures directly to FXServer through a configured HTTPS reverse proxy. |
| `http` | Legacy alias for `https`; also requires an HTTPS endpoint under cerulean. |

## HTTPS Reverse Proxy

Set `protocol 'https'` in `fxmanifest.lua` and add the public FXServer base URL to `server.cfg` before starting the resource:

```cfg
setr screencapture_https_endpoint "https://capture.example.com"
ensure screencapture
```

Use `setr` to replicate the URL to clients. The convar defaults to empty, is ignored by the NUI transport, and is read for each capture. Restart the resource after changing its manifest protocol.

The resource appends `/<resource-name>` to the URL. For the default resource name, forward `https://capture.example.com/screencapture/*` to `http://127.0.0.1:30120/screencapture/*`, adjusting the FXServer address and port. Preserve the resource path and support POST, CORS preflights, and the necessary upload sizes. Players need to trust the proxy's HTTPS certificate.

The same base URL covers screenshot uploads, recorded-video chunks, and recording finalization, including screenshot-basic upload compatibility. Local-only screenshots continue to use NUI callbacks. An optional path prefix, such as `/fivem`, is supported if the proxy strips it before forwarding to FXServer.

Do not include the resource name, credentials, a query string, or a fragment in the base URL. The URL is visible to clients. Missing or invalid HTTPS configuration logs an error and prevents direct capture requests; there is no direct-IP HTTP fallback.

This controls the player-to-FXServer connection. Remote provider URLs and `screencapture_upload_ipv4` control the separate FXServer-to-provider connection.

## Bandwidth Settings

| Metadata | Default in manifest | Description |
| --- | ---: | --- |
| `images_bps` | `500000` | Latent event transfer rate for screenshot payloads. |
| `stream_bps` | `5000000` | Latent event transfer rate for video chunks. |

Lower these values if captures hit FiveM's latent event rate limit.

NUI screenshots use chunks of up to 256 KiB and are capped at 32 MiB including base64 encoding. A partial upload expires after 60 seconds without a new chunk. NUI recordings use 192 KiB chunks before base64 encoding.

## Upload IPv4

For servers with unreliable IPv6 connectivity, force IPv4 for remote screenshot and video uploads in `server.cfg`:

```text
set screencapture_upload_ipv4 true
```

The default is `false`, which keeps Node.js address selection. The setting is read for each upload and applies to HTTP and HTTPS upload URLs, including redirects.

## Upload Identity Headers

Remote screenshot uploads include server identity headers by default: `User-Agent`, `X-Screencapture-Server-Name`, `X-Screencapture-Upload-Host`, and `X-Screencapture-Resource`. These expose the FiveM server name and resource name to the upload provider.

Disable the headers in your server config if you do not want to send this metadata:

```text
set screencapture_upload_identity_headers false
```

User-provided upload headers override the defaults.
