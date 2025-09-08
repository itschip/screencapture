fx_version 'bodacious'

version '0.9.2'

game "gta5"

client_script "game/dist/client.js"
server_script "game/dist/server.js"

ui_page "game/nui/dist/index.html"
files {
    "game/nui/dist/index.html",
    "game/nui/dist/**/*",
}

provide 'screenshot-basic'