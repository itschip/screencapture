fx_version 'bodacious'

version '0.13.0-beta.2'

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

-- use 'nui' if you're having trouble with uploads
protocol 'http'

-- bytes per second for nui protocol
-- change this as you like
images_bps '1000000'
stream_bps '5000000'