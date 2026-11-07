---
title: Configuration
description: Configure capture protocol and latent event bandwidth settings.
---

`fxmanifest.lua` controls the capture transport and latent event bandwidth.

```lua
provide 'screenshot-basic'

-- use 'nui' if uploads through the HTTP protocol cause issues
protocol 'http'

-- bytes per second for latent image and stream transfers
images_bps '1000000'
stream_bps '5000000'
```

## Protocols

| Protocol | Description |
| --- | --- |
| `http` | Default. Sends captures through the resource HTTP endpoint. |
| `nui` | Uses NUI callbacks as a fallback when HTTP uploads are unreliable in a specific server or client environment. |

## Bandwidth Settings

| Metadata | Default in manifest | Description |
| --- | ---: | --- |
| `images_bps` | `1000000` | Latent event transfer rate for screenshot payloads. |
| `stream_bps` | `5000000` | Latent event transfer rate for video chunks. |

Increase these values for faster transfer on capable servers. Lower them if captures create network pressure.

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
