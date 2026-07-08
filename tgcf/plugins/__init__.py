"""Subpackage of tgcf: plugins.

Contains all the first-party tgcf plugins.
"""

import inspect
import logging
from enum import Enum
from importlib import import_module
from typing import Any, Dict, Optional

from telethon.tl.custom.message import Message

from tgcf.config import CONFIG
from tgcf.utils import cleanup, stamp

PLUGINS = CONFIG.plugins


class FileType(str, Enum):
    AUDIO = "audio"
    GIF = "gif"
    VIDEO = "video"
    VIDEO_NOTE = "video_note"
    STICKER = "sticker"
    CONTACT = "contact"
    PHOTO = "photo"
    DOCUMENT = "document"
    POLL = "poll"
    DICE = "dice"
    STORY = "story"
    NOFILE = "nofile"


class TgcfMessage:
    def __init__(self, message: Message) -> None:
        self.message = message
        self.text = self.message.text
        self.raw_text = self.message.raw_text
        self.sender_id = self.message.sender_id
        self.file_type = self.guess_file_type()
        self.new_file: Optional[str] = None
        self.cleanup = False
        self.reply_to: Optional[int] = None

    async def get_file(self) -> str:
        """Download the file in the message and return the local path."""
        if self.file_type == FileType.NOFILE:
            raise FileNotFoundError("No file exists in this message.")
        self.file = stamp(await self.message.download_media(""), self.sender_id)
        return self.file

    def guess_file_type(self) -> FileType:
        for i in FileType:
            if i == FileType.NOFILE:
                return i
            obj = getattr(self.message, i.value, None)
            if obj:
                return i
        return FileType.NOFILE

    def clear(self) -> None:
        if self.new_file and self.cleanup:
            cleanup(self.new_file)
            self.new_file = None


class TgcfPlugin:
    id_ = "plugin"

    def __init__(self, data: Dict[str, Any]) -> None:
        self.data = data

    def modify(self, tm: TgcfMessage) -> TgcfMessage:
        """Modify the message here."""
        return tm


def load_plugins() -> Dict[str, TgcfPlugin]:
    """Load the plugins specified in config."""
    _plugins: Dict[str, TgcfPlugin] = {}
    for plugin_id, plugin_data in PLUGINS.items():
        if not plugin_data:
            plugin_data = {}
        plugin_class_name = f"Tgcf{plugin_id.title()}"

        try:
            plugin_module = import_module("tgcf.plugins." + plugin_id)
        except ModuleNotFoundError:
            logging.error(
                "%s is not a first-party plugin. Trying third-party plugins.", plugin_id
            )
            plugin_module_name = f"tgcf_{plugin_id}"
            try:
                plugin_module = import_module(plugin_module_name)
            except ModuleNotFoundError:
                logging.error(
                    "Module %s not found. Failed to load plugin %s",
                    plugin_module_name,
                    plugin_id,
                )
                continue
            else:
                logging.info("Plugin %s loaded from third-party plugins.", plugin_id)
        else:
            logging.info("First-party plugin %s loaded.", plugin_id)

        try:
            plugin_class = getattr(plugin_module, plugin_class_name)
            if not issubclass(plugin_class, TgcfPlugin):
                logging.error(
                    "Plugin class %s does not inherit TgcfPlugin", plugin_class_name
                )
                continue
            plugin: TgcfPlugin = plugin_class(plugin_data)
            if plugin.id_ != plugin_id:
                logging.error("Plugin id for %s does not match expected id.", plugin_id)
                continue
        except AttributeError:
            logging.error("Found plugin %s but plugin class not found.", plugin_id)
        else:
            logging.info("Loaded plugin %s.", plugin_id)
            _plugins[plugin.id_] = plugin
    return _plugins


async def apply_plugins(message: Message) -> Optional[TgcfMessage]:
    """Apply all loaded plugins to a message."""
    tm = TgcfMessage(message)

    for _id, plugin in plugins.items():
        try:
            if inspect.iscoroutinefunction(plugin.modify):
                ntm = await plugin.modify(tm)
            else:
                ntm = plugin.modify(tm)
        except Exception as err:
            logging.error("Failed to apply plugin %s: %s", _id, err)
        else:
            logging.info("Applied plugin %s.", _id)
            if not ntm:
                tm.clear()
                return None
    return tm


plugins = load_plugins()
