"""Utility functions for tgcf."""

import logging
import os
import re
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from telethon.client import TelegramClient
from telethon.errors import ChatForwardsRestrictedError
from telethon.hints import EntityLike
from telethon.tl.custom.message import Message
from telethon.tl.types import (
    InputMediaPoll,
    MessageEntitySpoiler,
    MessageMediaPoll,
)

from tgcf.config import CONFIG

if TYPE_CHECKING:
    from tgcf.plugins import TgcfMessage


def _has_spoiler_entity(message: Message) -> bool:
    """Return True if the message contains a spoiler text entity."""
    if not message.entities:
        return False
    return any(isinstance(e, MessageEntitySpoiler) for e in message.entities)


def _media_has_spoiler(message: Message) -> bool:
    """Return True if the message media has the spoiler flag set."""
    media = message.media
    return bool(getattr(media, "spoiler", False))


async def send_message(
    recipient: EntityLike,
    tm: "TgcfMessage",
    topic_id: Optional[int] = None,
) -> Message:
    """Forward or send a copy of *tm* to *recipient*.

    Parameters
    ----------
    recipient:
        Target chat / channel / user.
    tm:
        The wrapped message produced by the plugin pipeline.
    topic_id:
        When *recipient* is a forum group, pass the topic (thread) ID here
        so the message lands in the correct topic.
    """
    client: TelegramClient = tm.message.client
    reply_to = tm.reply_to or topic_id

    if CONFIG.show_forwarded_from:
        try:
            return await client.forward_messages(
                recipient,
                tm.message,
                drop_author=False,
            )
        except ChatForwardsRestrictedError:
            logging.warning(
                "Source chat has forwarding restricted — falling back to copy mode."
            )
        except Exception as err:
            logging.warning("forward_messages failed (%s) — falling back to copy.", err)

    # --- copy mode (no "Forwarded from …" header) ---

    # Re-upload a processed/watermarked file produced by a plugin
    if tm.new_file:
        return await client.send_file(
            recipient,
            tm.new_file,
            caption=tm.text,
            reply_to=reply_to,
            protect_content=CONFIG.protect_content,
        )

    # Re-send a poll (polls cannot be forwarded as copies via send_message)
    if isinstance(tm.message.media, MessageMediaPoll):
        poll: MessageMediaPoll = tm.message.media
        try:
            return await client.send_file(
                recipient,
                InputMediaPoll(poll=poll.poll),
                reply_to=reply_to,
                protect_content=CONFIG.protect_content,
            )
        except Exception as err:
            logging.warning("Could not re-send poll: %s", err)
            return None

    # Re-send any other file/media
    if tm.file_type.value != "nofile":
        spoiler = _media_has_spoiler(tm.message)
        return await client.send_file(
            recipient,
            tm.message.media,
            caption=tm.text,
            reply_to=reply_to,
            spoiler=spoiler,
            protect_content=CONFIG.protect_content,
        )

    # Plain text message
    tm.message.text = tm.text
    return await client.send_message(
        recipient,
        tm.message,
        reply_to=reply_to,
        protect_content=CONFIG.protect_content,
    )


async def send_album(
    recipient: EntityLike,
    client: TelegramClient,
    messages: list[Message],
    topic_id: Optional[int] = None,
) -> list[Message]:
    """Send a grouped album of media to *recipient*.

    Falls back to forwarding the group if copy-mode is not needed.
    """
    reply_to = topic_id

    if CONFIG.show_forwarded_from:
        try:
            return await client.forward_messages(recipient, messages)
        except ChatForwardsRestrictedError:
            logging.warning("Album source restricted — falling back to copy mode.")
        except Exception as err:
            logging.warning("Album forward failed (%s) — falling back to copy.", err)

    # Copy mode: collect media files and captions
    files = [msg.media for msg in messages if msg.media]
    if not files:
        return []

    # Use caption from the first message that has one
    caption = next((msg.text for msg in messages if msg.text), "")
    spoiler = any(_media_has_spoiler(msg) for msg in messages)

    return await client.send_file(
        recipient,
        files,
        caption=caption,
        reply_to=reply_to,
        spoiler=spoiler,
        protect_content=CONFIG.protect_content,
    )


def cleanup(*files: str) -> None:
    """Delete the file names passed as args."""
    for file in files:
        try:
            os.remove(file)
        except FileNotFoundError:
            logging.info("File %s does not exist, so can't delete it.", file)


def stamp(file: str, user: str) -> str:
    """Stamp the filename with the datetime and user info."""
    now = str(datetime.now())
    outf = safe_name(f"{user} {now} {file}")
    try:
        os.rename(file, outf)
        return outf
    except Exception as err:
        logging.warning("Stamping file name failed for %s to %s. %s", file, outf, err)
        return file


def safe_name(string: str) -> str:
    """Return a file-system-safe version of *string*."""
    return re.sub(pattern=r"[-!@#$%^&*()\s]", repl="_", string=string)


def match(pattern: str, string: str, regex: bool) -> bool:
    if regex:
        return bool(re.findall(pattern, string))
    return pattern in string


def replace(pattern: str, new: str, string: str, regex: bool) -> str:
    if regex:
        return re.sub(pattern, new, string)
    return string.replace(pattern, new)
