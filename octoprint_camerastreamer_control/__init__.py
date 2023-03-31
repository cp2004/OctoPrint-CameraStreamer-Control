import pathlib

import octoprint.plugin

from octoprint.schema.webcam import Webcam, WebcamCompatibility


class CameraStreamerControlPlugin(
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.TemplatePlugin,
    octoprint.plugin.WebcamProviderPlugin,
):
    def get_settings_defaults(self):
        return {
            "mode": "webrtc",
            "url": "/webcam/",
            "show_warning": True,
            "flipH": False,
            "flipV": False,
            "rotate90": False,
            "timeout": 5,
            "mjpg_timeout": 5,
            # TODO there's a lot more settings that should go here
        }

    def get_template_vars(self):
        # In early OctoPi-UpToDate builds (build 20230322130804 or older)
        # camera-streamer was installed from source here
        camera_streamer_path_old = pathlib.Path("usr", "local", "bin", "camera-streamer")

        # Later releases installed via apt and it moved
        camera_streamer_path = pathlib.Path("usr", "bin", "camera-streamer")

        # TODO check OctoPi-UpToDate version as well?

        return {
            "installed": camera_streamer_path.exists() or camera_streamer_path_old.exists(),
        }

    def get_assets(self):
        return {
            "js": ["js/camerastreamer_control.js"],
            "css": ["css/camerastreamer_control.css"],
        }

    def get_update_information(self):
        return {
            "camerastreamer_control": {
                "displayName": "camera-streamer Control",
                "displayVersion": self._plugin_version,
                "type": "github_release",
                "user": "cp2004",
                "repo": "OctoPrint-CameraStreamer-Control",
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
                "pip": "https://github.com/cp2004/OctoPrint-CameraStreamer-Control/releases/download/{target_version}/release.zip",
            }
        }

    def get_webcam_configurations(self):
        return [
            Webcam(
                name=self._identifier,
                displayName="Camera Streamer",
                canSnapshot=True,  # TODO configurable?
                snapshotDisplay="blub",  # optional
                flipH=self._settings.get_boolean(["flipH"]),
                flipV=self._settings.get_boolean(["flipV"]),
                rotate90=self._settings.get_boolean(["rotate90"]),
                # compat=WebcamCompatibility()  # TODO
            )
        ]

    # TODO a get_template_configs to name the webcam in the control tab


# TODO check styling of camera-streamer actual name
__plugin_name__ = "Camera Streamer Control"
__plugin_pythoncompat__ = ">=3.7,<4"


def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = CameraStreamerControlPlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
    }
