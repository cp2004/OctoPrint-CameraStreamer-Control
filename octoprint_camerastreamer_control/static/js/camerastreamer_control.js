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
         *  Goal 1: Support Mjpg & WebRTC streams smoothly for one camera
         *  * timeout if webrtc doesn't load
         *  * Smooth settings configuration
         *  Goal 2: Support multiple camera-streamer cameras - this is stretch goal for future
         *  Finally: sort out logging
         */
        var self = this;

        self.settingsViewModel = parameters[0];
        self.loginState = parameters[1];

        self.getSetting = function (path) {
            const setting_path = []
            if (typeof path === "string") {
                setting_path.push(path)
            } else {
                setting_path.push(...path)
            }

            let current = self.settingsViewModel.settings.plugins.camerastreamer_control

            setting_path.forEach((setting) => {
                current = current[setting]
            })

            return current
        }

        self.webcamVisible = ko.observable(false)
        self.webcamPiP = ko.observable(false)
        self.currentMode = ko.observable("")
        self.streamStopTimer = null
        self.fallbackError = ko.observable(false)

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
            if (self.webcamPiP()) {
                // Playing in PiP mode - leave it alone
                // Don't stop or start the stream
                return
            }
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
                // We were timing out to stop the stream, but we don't need to any more.
                // So just clear the timeout and do nothing
                log("Aborting timeout")
                clearTimeout(self.streamStopTimer)
                self.streamStopTimer = null
                return
            }

            log("Starting stream")
            self.fallbackError(false)

            // Try starting the preferred video method
            const map = {
                'mjpg': self.startMjpg,
                'webrtc': self.startWebRTC
            }

            const mode = self.settingsViewModel.settings.plugins.camerastreamer_control.mode()

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

        self.fallback = function () {
            warn("Falling back to mjpg")
            self.fallbackError(true)
            self.startMjpg()
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
            const newsrc = self.getSetting("url")() + self.getSetting(["mjpg", "url"])()

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
            video.addEventListener('enterpictureinpicture', () => {
                self.webcamPiP(true)
            })
            video.addEventListener('leavepictureinpicture', () => {
                self.webcamPiP(false)
            })
            video.addEventListener('pause', (e) => {
                // TODO this is a hack because the video pauses when we switch tabs but I don't know
                //  what is triggering the pause
                // So we'll just play it again :)
                if (self.webcamPiP()){
                    e.target.play()
                    warn("Video paused but we're PiP, playing again")
                }
            })
            // Add size change listener to rotate the video
            video.onresize = self.rotateVideo

            // Heavily inspired by the camera-streamer page implementing webrtc, this does the same thing
            // https://github.com/ayufan/camera-streamer/blob/cdb62efd931b8bde5ab49d5319091714f48027b1/html/webrtc.html

            const pc = new RTCPeerConnection({
                sdpSemantics: 'unified-plan',
                iceServers: [  //  TODO configurable as comma separated list
                    {urls: self.getSetting(["webrtc", "stun"])().split(",").map(url => url.trim())},
                ]
            })
            self.webrtcPC = pc

            pc.addTransceiver('video', {direction: 'recvonly'})
            pc.addEventListener('track', (event) => {
                log(`track event: ${event.track.kind}`)
                if (event.track.kind === 'video') {
                    video.srcObject = event.streams[0]
                }
            })

            const url = self.getSetting("url")() + self.getSetting(["webrtc", "url"])()

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

                return fetch(url, {
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
                self.fallback()
            })
        }

        self.stopWebRTC = function () {
            log("Stopping WebRTC stream")
            self.currentMode("")
            self.webcamPiP(false)
            if (self.webrtcPC === null) {
                return
            }
            self.webrtcPC.close()
        }

        self.onAfterBinding = function() {
            // If rotation changes, might need to re-adjust video size
            self.getSetting("rotate90").subscribe(self.rotateVideo)
        }

        self.rotateVideo = function () {
            const video = document.getElementById(id("webrtc_video"))
            const rotation_container = document.getElementById(id("webrtc_container"))

            if (!video) {
                // Webrtc video not enabled/not streaming, nothing to do
                return
            }

            if (self.getSetting("rotate90")()) {
                // Make the container square
                rotation_container.style.height = rotation_container.offsetWidth + "px"
                // Remove the initial padding we gave the element from css.
                rotation_container.style.paddingBottom = '0';
                // Swap height and width
                video.style.height = rotation_container.offsetWidth + "px"
                video.style.width = rotation_container.offsetHeight + "px"
            } else {
                rotation_container.style.height = ""
                rotation_container.style.paddingBottom = "";
                video.style.height = ""
                video.style.width = ""
            }
        }

        // Video controls
        self.reloadStream = function () {
            // Might be useful if the stream is stuck
            self.stopStream(true)
            self.startStream()
        }

        self.fullscreen = function () {
            const video = document.getElementById(id("webrtc_video"))
            video.requestFullscreen()
        }

        self.togglePiP = function () {
            const video = document.getElementById(id("webrtc_video"))
            video.requestPictureInPicture()
        }
    }
    OCTOPRINT_VIEWMODELS.push({
        construct: CameraStreamerControlViewModel,
        dependencies: ["settingsViewModel", "loginStateViewModel"],
        elements: ["#settings_plugin_camerastreamer_control", "#webcam_plugin_camerastreamer_control"]
    });
});
