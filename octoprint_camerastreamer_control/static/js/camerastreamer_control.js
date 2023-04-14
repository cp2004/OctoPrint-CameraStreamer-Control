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

    const log = (msg) => {
        console.log(`CSC: ${msg}`)
    }
    const warn = (msg) => {
        console.warn(`CSC: ${msg}`)
    }
    const error = (msg) => {
        console.error(`CSC: ${msg}`)
    }

    function CameraStreamerControlViewModel(parameters) {
        /* TODO list
         *  Bugs:
         *  * Intersection observer doesn't seem to like me scrolling on the page, sends signal to unload the stream. why? doesn't seem to do it with classicam
         *  Goal 1: Support Mjpg & WebRTC streams smoothly for one camera
         *  * timeout if webrtc doesn't load
         *  * Show warning if fallen back to mjpg
         *  * Smooth settings configuration
         *  * WebRTC stun make it a comma separated list
         *  * Flip & rotate
         *  Goal 3: Support multiple camera-streamer cameras
         *  Finally: sort out logging
         */
        var self = this;

        self.settingsViewModel = parameters[0];
        self.loginState = parameters[1];

        self.getSetting = function (name) {
            // TODO work with nested settings
            return self.settingsViewModel.settings.plugins.camerastreamer_control[name]
        }

        self.webcamVisible = ko.observable(false)
        self.webcamPiP = ko.observable(false)
        self.currentMode = ko.observable("")
        self.streamStopTimer = null

        self.webcamClass = ko.pureComputed(() => {
            const flipH = self.getSetting("flipH")() ? 'csc-flipH' : ''
            const flipV = self.getSetting("flipV")() ? 'csc-flipV' : ''
            const rotate90 = self.getSetting("rotate90")() ? 'csc-rotate90' : ''
            return `${flipH} ${flipV} ${rotate90}`
        })

        self.webcamPiP.subscribe((enabled) => {
            if (!enabled && !self.webcamVisible()) {
                // Stop stream if PiP disabled and webcam not visible
                self.stopStream()
            }
        })

        self.onWebcamVisibilityChange = function (visible) {
            const current = self.webcamVisible()
            if (current === visible) {
                // Likely first load when we get sent `false` for the first time, but we default to false
                return
            }

            log("Webcam visibility changed: " + visible)
            self.webcamVisible(visible)
            if (visible) {
                self.startStream()
            } else {
                // If PiP active we don't want to stop the stream
                if (!self.webcamPiP()) {
                    self.stopStream()
                }
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
                log("Aborting timeout")
                clearTimeout(self.streamStopTimer)
                self.streamStopTimer = null
                return
            }

            log("Starting stream")

            // Try starting the preferred video method
            const map = {
                'mjpg': self.startMjpg,
                'webrtc': self.startWebRTC
            }

            const mode = self.settingsViewModel.settings.plugins.camerastreamer_control.mode()

            const fallback = () => {
                warn("Falling back to mjpg")
                self.startMjpg()
            }

            try {
                if (!(mode in map)) {
                    error("Unknown video mode: " + mode)
                    fallback()
                }
                map[mode]()
            } catch (err) {
                error("Error starting stream: " + mode)
                error(err)
                fallback()
            }
        }

        self.stopStream = function (force) {
            if (!force) {
                // Set a timeout to stop the stream, so it doesn't stop and start too quickly
                const timeout = self.getSetting("timeout")() * 1000

                log(`Stopping stream in ${timeout / 1000} seconds`)


                if (self.streamStopTimer !== null) {
                    clearTimeout(self.streamStopTimer)
                }

                self.streamStopTimer = setTimeout(() => {
                    self.streamStopTimer = null
                    self.stopStream(true)
                }, timeout)

                return
            }

            log("Stopping stream")

            const map = {
                'mjpg': self.stopMjpg,
                'webrtc': self.stopWebRTC,
                '': () => {}, // no webcam is active, do nothing
                'error': () => {}  // nothing to stop...
            }

            try {
                map[self.currentMode()]()
            } catch (err) {
                error("Error stopping stream: " + self.currentMode())
                error(err)
            }
            map[self.currentMode()]()
        }

        self.startMjpg = function () {
            self.currentMode("mjpg")
            log("Starting MJPG stream from " + self.getSetting("url")())

            const element = document.getElementById(id("mjpg_image"))
            const currentsrc = element.getAttribute("src")

            // TODO safari bug workaround

            // Camera streamer uses `stream` or `?action=stream`
            const newsrc = `${self.getSetting("url")()}stream`

            if (currentsrc !== newsrc) {
                // TODO cache buster
                log("Setting new MJPG stream: " + newsrc)
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
            error("Mjpg stream failed to load at: " + self.getSetting("url")())
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
            log("Starting WebRTC stream from " + self.getSetting("url")())

            const video = document.getElementById(id("webrtc_video"))

            // Add PiP status listener
            // TODO not needed when using custom controls for rotation
            video.addEventListener('enterpictureinpicture', () => {
                self.webcamPiP(true)
            })
            video.addEventListener('leavepictureinpicture', () => {
                self.webcamPiP(false)
            })

            // Heavily inspired by the camera-streamer page implementing webrtc, this does the same thing
            // https://github.com/ayufan/camera-streamer/blob/cdb62efd931b8bde5ab49d5319091714f48027b1/html/webrtc.html
            const config = {
                sdpSemantics: 'unified-plan',
                iceServers: [  //  TODO configurable as comma separated list
                    {urls: self.settingsViewModel.settings.plugins.camerastreamer_control.webrtc.stun()},
                ]
            }

            const pc = new RTCPeerConnection(config)
            self.webrtcPC = pc

            pc.addTransceiver('video', {direction: 'recvonly'})
            pc.addEventListener('track', (event) => {
                log(`track event: ${event.track.kind}`)
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
            }).catch((err) => {
                error("Error loading WebRTC Stream")
                error(err)
                warn("Falling back to mjpg")
                self.startMjpg()
            })
        }

        self.stopWebRTC = function () {
            log("Stopping WebRTC stream")
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
