RegisterCommand("capture", () => {
    console.log("Capture")
    SendNUIMessage({
        action: "capture",
        url: "https://www.uploadurl.com",
        serverEndpoint: `http://${GetCurrentServerEndpoint()}/${GetCurrentResourceName()}/upload`
    })
}, false)