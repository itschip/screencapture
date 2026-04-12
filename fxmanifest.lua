fx_version 'bodacious'

version '0.12.0'

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

protocol 'http' -- should be http for local development