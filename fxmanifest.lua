fx_version 'bodacious'

version '0.10.1'

game "gta5"

node_version '22'

dependencies {
    '/server:25988',
    '/onesync',
}

client_script "game/dist/client.js"
server_script "game/dist/server.js"

ui_page "game/nui/dist/index.html"
files {
    "game/nui/dist/index.html",
    "game/nui/dist/**/*",
}

provide 'screenshot-basic'