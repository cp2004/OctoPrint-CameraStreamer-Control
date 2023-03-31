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
        /* TODO list
         *  Bugs:
         *  * Intersection observer doesn't seem to like me scrolling on the page, sends signal to unload the stream. why? doesn't seem to do it with classicam
         *  Goal 1: Support Mjpg & WebRTC streams smoothly for one camera
         *  * timeout if webrtc doesn't load
         *  * Show warning if fallen back to mjpg
         *  * Error message if mjpg doesn't load
         *  * Smooth settings configuration
         *  Goal 2: Support snapshots for one camera (can then disable classicwebcam)
         *  Goal 3: Support multiple camera-streamer cameras
         */
        var self = this;

        self.settingsViewModel = parameters[0];
        self.loginState = parameters[1];

        self.getSetting = function (name) {
            // TODO work with nested settings
            return self.settingsViewModel.settings.plugins.camerastreamer_control[name]
        }

        self.webcamVisible = ko.observable(false)
        self.currentMode = ko.observable("")
        self.streamStopTimer = null

        self.onWebcamVisibilityChange = function (visible) {
            console.log("CSC Webcam visibility changed: " + visible)
            self.webcamVisible(visible)
            if (visible) {
                self.startStream()
            } else {
                self.stopStream()
            }
        }

        self.onWebcamVisbilityChange = self.onWebcamVisibilityChange  // This is a typo in OctoPrint 1.9.0rc1-3

        self.onEventSettingsUpdated = function () {
            // Reload the stream when settings are changed
            // TODO doesn't need to happen for all settings, presumably just csc ones
            self.stopStream(true)
            self.startStream()
        }

        self.startStream = function () {
            if (self.streamStopTimer !== null) {
                // We were timing out to stop the stream, but we don't need to anymore.
                // So just clear the timeout and do nothing
                console.log("aborting timeout")
                clearTimeout(self.streamStopTimer)
                self.streamStopTimer = null
                return
            }

            console.log("Starting stream")

            // Try starting the preferred video method
            const map = {
                'mjpg': self.startMjpg,
                'webrtc': self.startWebRTC
            }

            const mode = self.settingsViewModel.settings.plugins.camerastreamer_control.mode()

            const fallback = () => {
                console.warn("Falling back to mjpg")
                self.startMjpg()
            }

            try {
                if (!(mode in map)) {
                    console.error("Unknown video mode: " + mode)
                    fallback()
                }
                map[mode]()
            } catch (err) {
                console.error("Error starting stream: " + mode)
                console.error(err)
                fallback()
            }
        }

        self.stopStream = function (force) {
            if (!force) {
                console.log("Stopping stream in timeout seconds")
                // Set a timeout to stop the stream, so it doesn't stop and start too quickly
                const timeout = self.getSetting("timeout")() * 1000

                if (self.streamStopTimer !== null) {
                    clearTimeout(self.streamStopTimer)
                }

                self.streamStopTimer = setTimeout(() => {
                    self.streamStopTimer = null
                    self.stopStream(true)
                }, timeout)

                return
            }

            console.log("Stopping stream")

            const map = {
                'mjpg': self.stopMjpg,
                'webrtc': self.stopWebRTC,
                '': () => {}, // no webcam is active, do nothing
                'error': () => {}  // nothing to stop...
            }

            try {
                map[self.currentMode()]()
            } catch (err) {
                console.error("Error stopping stream: " + self.currentMode())
                console.error(err)
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
            // TODO what do we need this for?
            // maybe useful for timeouts
        }

        self.onMjpgError = function () {
            console.error("Mjpg stream failed to load at: " + self.getSetting("url")())
            // Display an error message to the user
            self.currentMode("error")
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
                // todo abort fetch with AbortController
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
                console.error("Error loading WebRTC Stream")
                console.error(error)
                console.warn("Falling back to mjpg")
                self.startMjpg()
            })
        }

        self.stopWebRTC = function () {
            // TODO don't stop the stream if playing in PIP mode

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
        dependencies: ["settingsViewModel", "loginStateViewModel"],
        elements: ["#settings_plugin_camerastreamer_control", "#webcam_plugin_camerastreamer_control"]
    });
});
