import pathlib
import requests
import threading

import octoprint.plugin

from octoprint.schema.webcam import Webcam, WebcamCompatibility


class CameraStreamerControlPlugin(
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.TemplatePlugin,
    octoprint.plugin.WebcamProviderPlugin,
):
    _capture_mutex = threading.Lock()

    def take_webcam_snapshot(self, _):
        snapshot_url = self._build_url(self._settings.get(["url"]), "snapshot")

        with self._capture_mutex:
            self._logger.debug(f"Capturing image from {snapshot_url}")
            r = requests.get(
                snapshot_url,
                stream=True,
                timeout=self._settings.get_int(["snapshot", "timeout"]),
                verify=self._settings.get_boolean(["snapshot", "validate_ssl"]),
            )
            r.raise_for_status()
            return r.iter_content(chunk_size=1024)

    def get_settings_defaults(self):
        return {
            "mode": "webrtc",
            "url": "/webcam/",
            "flipH": False,
            "flipV": False,
            "rotate90": False,
            "timeout": 5,
            "webrtc": {
                "url": "webrtc",
                "stun": "stun:stun.l.google.com:19302",
            },
            "mjpg": {
                "url": "stream",
                "cacheBuster": False,
            },
            "snapshot": {
                "url": "snapshot",
                "timeout": 5,
                "validate_ssl": True,
            }
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
        base_url = self._settings.get(["url"])
        snapshot_url = self._build_url(base_url, "snapshot")
        mode = self._settings.get(["mode"])
        preferred_url = self._build_url(base_url, mode)

        return [
            Webcam(
                name=self._identifier,
                displayName="Camera Streamer",
                canSnapshot=True,
                snapshotDisplay=snapshot_url,
                flipH=self._settings.get_boolean(["flipH"]),
                flipV=self._settings.get_boolean(["flipV"]),
                rotate90=self._settings.get_boolean(["rotate90"]),
                compat=WebcamCompatibility(
                    stream=self._build_url(base_url, "mjpg"),
                    streamTimeout=self._settings.get_int(["timeout"]),
                    streamRatio="16:9",  # Required for compatibility, but we don't actually use
                    streamWebrtcIceServers=[self._settings.get(["webrtc", "stun"])],
                    snapshot=snapshot_url,
                    snapshotTimeout=self._settings.get(["snapshot", "timeout"]),
                    snapshotSslValidation=self._settings.get(["snapshot", "validate_ssl"])
                ),
                extras={
                    "mode": mode,
                    "url": preferred_url,
                    "webrtc": {
                        "stun": self._settings.get(["webrtc", "stun"]),
                    },
                    "mjpg": {
                        "cacheBuster": self._settings.get_boolean(["mjpg", "cacheBuster"]),
                    },
                }
            )
        ]

    def _build_url(self, url, mode):
        """
        Construct a URL for the selected stream type
        :return: string: URL to request for stream
        """

        url = url.rstrip("/")

        if mode == "webrtc":
            return f"{url}/{self._settings.get(['webrtc', 'url'])}"
        elif mode == "mjpg":
            return f"{url}/{self._settings.get(['mjpg', 'url'])}"
        elif mode == "snapshot":
            if not url.startswith("http"):
                return f"http://127.0.0.1/{url.lstrip('/')}/{self._settings.get(['snapshot', 'url']).strip('/')}"
            else:
                return f"{url}/{self._settings.get(['snapshot', 'url']).strip('/')}"

    def get_template_configs(self):
        return [
            {
                "type": "webcam",
                "template": "camerastreamer_control_webcam.jinja2",
                "name": "Camera Streamer",
            }
        ]


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
