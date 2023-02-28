/*
 * View model for OctoPrint-WebRTC-CameraStreamer
 *
 * Author: Charlie Powell
 * License: AGPLv3
 */
$(function() {
    function Webrtc_camerastreamerViewModel(parameters) {
        var self = this;

        self.settingsViewModel = parameters[0];
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: Webrtc_camerastreamerViewModel,
        dependencies: ["settingsViewModel"],
        elements: ["#settings_plugin_webrtc_camerastreamer"]
    });
});
