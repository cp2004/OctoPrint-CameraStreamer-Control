/*
 * View model for OctoPrint-WebRTC-CameraStreamer
 *
 * Author: Charlie Powell
 * License: AGPLv3
 */
$(function() {
    function id(name) {
        return `camerastreamer_control_${name}`
    }

    function CameraStreamerControlViewModel(parameters) {
        var self = this;

        self.settingsViewModel = parameters[0];

        self.getSetting = function (name) {
            // TODO work with nested settings
            return self.settingsViewModel.settings.plugins.camerastreamer_control[name]
        }

        self.webcamVisible = ko.observable(false)
        self.currentMode = ko.observable("")

        //self.onWebcamVisibilityChange = function (visible) {  // TODO this is a typo in OctoPrint
        self.onWebcamVisbilityChange = function (visible) {
            console.log("CSC Webcam visibility changed: " + visible)
            self.webcamVisible(visible)
            if (visible) {
                self.startStream()
            } else {
                self.stopStream()
            }
        }

        // TODO update on settings change as well to collect new config

        self.startStream = function () {
            // TODO timeout so we don't try and start too fast
            // Try starting the preferred video method
            const map = {
                'mjpg': self.startMjpg,
                'webrtc': self.startWebRTC
            }

            const config = self.settingsViewModel.settings.plugins.camerastreamer_control.mode()
            if (config in map) {
                map[config]()
            } else {
                console.error("Unknown video mode: " + config)
                // Fall back to mjpg as much as possible
                self.startMjpg()
            }
        }

        self.stopStream = function () {
            const map = {
                'mjpg': self.stopMjpg,
                'webrtc': self.stopWebRTC,
                '': () => {} // no webcam is active, do nothing
            }

            map[self.currentMode()]()
        }

        self.startMjpg = function () {
            self.currentMode("mjpg")
            console.log("Starting MJPG stream: " + self.getSetting("url")())

            const element = document.getElementById(id("mjpg_image"))
            const currentsrc = element.getAttribute("src")

            // TODO safari bug workaround

            // Camera streamer uses `stream` or `?action=stream`
            const newsrc = `${self.getSetting("url")()}stream`

            if (currentsrc !== newsrc) {
                // TODO cache buster
                console.log("Setting new MJPG stream: " + newsrc)
                element.setAttribute("src", newsrc)
            }
        }

        self.stopMjpg = function () {
            const element = document.getElementById(id("mjpg_image"))
            // If we are on safari, this won't actually unload the stream
            // TODO safari bug workaround
            element.setAttribute("src", "")
            self.currentMode("")
        }

        self.onMjpgLoaded = function () {

        }

        self.onMjpgError = function () {

        }

        // webrtc mode

        self.webrtcPC = null

        self.startWebRTC = function () {
            // Ensure that webrtc is not already running
            if (self.webrtcPC !== null) {
                self.stopWebRTC()
            }

            self.currentMode("webrtc")
            console.log("Starting WebRTC stream: " + self.getSetting("url")())

            const video = document.getElementById(id("webrtc_video"))

            // Heavily inspired by the camera-streamer page implementing webrtc, this does the same thing
            // https://github.com/ayufan/camera-streamer/blob/cdb62efd931b8bde5ab49d5319091714f48027b1/html/webrtc.html
            const config = {
                sdpSemantics: 'unified-plan',
                iceServers: [  //  TODO configurable
                    {urls: 'stun:stun.l.google.com:19302'},
                ]
            }

            const pc = new RTCPeerConnection(config)
            self.webrtcPC = pc

            pc.addTransceiver('video', {direction: 'recvonly'})
            pc.addEventListener('track', (event) => {
                console.log(`track event: ${event.track.kind}`)
                if (event.track.kind === 'video') {
                    video.srcObject = event.streams[0]
                }
            })

            const url = `${self.getSetting("url")()}webrtc`

            fetch(url, {
                body: JSON.stringify({
                    type: 'request',
                }),
                method: 'POST',
            }).then((response) => {
                return response.json()
            }).then((answer) => {
                pc.remote_pc_id = answer.id
                return pc.setRemoteDescription(answer)
            }).then(() => {
                return pc.createAnswer()
            }).then((answer) => {
                return pc.setLocalDescription(answer)
            }).then(() => {
                // Wait for ICE gathering to complete
                return new Promise((resolve) => {
                    if (pc.iceGatheringState === 'complete') {
                        resolve()
                    } else {
                        const checkState = () => {
                            if (pc.iceGatheringState === 'complete') {
                                pc.removeEventListener('icegatheringstatechange', checkState)
                                resolve()
                            }
                        }
                        pc.addEventListener('icegatheringstatechange', checkState)
                    }
                })
            }).then((answer) => {
                const offer = pc.localDescription

                return fetch(url,{
                    body: JSON.stringify({
                        type: offer.type,
                        id: pc.remote_pc_id,
                        sdp: offer.sdp,
                    }),
                    method: 'POST',
                })
            }).then((response) => {
                return response.json()
            }).catch((error) => {
                // TODO handle errors
                // and fall back to mjpg
                console.error(error)
            })
        }

        self.stopWebRTC = function () {
            console.log("Stopping WebRTC stream")
            self.currentMode("")
            if (self.webrtcPC === null) {
                return
            }

            self.webrtcPC.close()
        }
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: CameraStreamerControlViewModel,
        dependencies: ["settingsViewModel"],
        elements: ["#settings_plugin_camerastreamer_control", "#webcam_plugin_camerastreamer_control"]
    });
});
