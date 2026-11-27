fx_version 'cerulean'

version '0.17.2'

game "gta5"

node_version '22'

client_script "game/dist/client.js"
server_script "game/dist/server.js"

ui_page "game/nui/dist/index.html"
files {
    "game/nui/dist/index.html",
    "game/nui/dist/**/*",
}

provide 'screenshot-basic'

-- use 'https' with the replicated screencapture_https_endpoint convar for a reverse proxy
protocol 'nui'

-- bytes per second for nui protocol
-- change this as you like
images_bps '500000'
stream_bps '5000000'
