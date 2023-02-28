import octoprint.plugin


class WebrtcCameraStreamerPlugin(
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.TemplatePlugin
):

    ##~~ SettingsPlugin mixin

    def get_settings_defaults(self):
        return {
            # put your plugin's default settings here
        }

    def get_assets(self):
        return {
            "js": ["js/webrtc_camerastreamer.js"],
            "css": ["css/webrtc_camerastreamer.css"],
        }

    def get_update_information(self):
        return {
            "webrtc_camerastreamer": {
                "displayName": "WebRTC-CameraStreamer",
                "displayVersion": self._plugin_version,
                "type": "github_release",
                "user": "cp2004",
                "repo": "OctoPrint-WebRTC-CameraStreamer",
                "stable_branch": {
                    "name": "Stable",
                    "branch": "main",
                    "comittish": ["main"],
                },
                "prerelease_branches": [
                    {
                        "name": "Release Candidate",
                        "branch": "pre-release",
                        "comittish": ["pre-release", "main"],
                    }
                ],
                "current": self._plugin_version,
                "pip": "https://github.com/cp2004/OctoPrint-WebRTC-CameraStreamer/releases/download/{target_version}/release.zip",
            }
        }


__plugin_name__ = "WebRTC-CameraStreamer"
__plugin_pythoncompat__ = ">=3.7,<4"

def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = WebrtcCameraStreamerPlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
    }
