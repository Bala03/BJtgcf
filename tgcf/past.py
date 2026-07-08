"""The module for running tgcf in past mode.

- past mode can only operate with a user account.
- past mode deals with all existing messages.
"""

import asyncio
import logging
import time
from collections import defaultdict
from typing import Dict, List

from telethon import TelegramClient
from telethon.errors.rpcerrorlist import FloodWaitError
from telethon.tl.custom.message import Message
from telethon.tl.patched import MessageService

from tgcf import config
from tgcf import storage as st
from tgcf.config import API_HASH, API_ID, CONFIG, SESSION, write_config
from tgcf.plugins import apply_plugins
from tgcf.utils import send_album, send_message


async def forward_job() -> None:
    """Forward all existing messages in the concerned chats."""
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        config.from_to = await config.load_from_to(client, config.CONFIG.forwards)
        client: TelegramClient
        for from_to, forward in zip(config.from_to.items(), config.CONFIG.forwards):
            src, dest = from_to
            last_id = 0
            forward: config.Forward
            logging.info("Forwarding messages from %s to %s", src, dest)

            # album_buffer groups messages by grouped_id for album forwarding
            album_buffer: Dict[int, List[Message]] = defaultdict(list)

            async for message in client.iter_messages(
                src, reverse=True, offset_id=forward.offset
            ):
                message: Message
                event = st.DummyEvent(message.chat_id, message.id)
                event_uid = st.EventUid(event)

                if forward.end and last_id > forward.end:
                    continue
                if isinstance(message, MessageService):
                    continue

                try:
                    # Album handling: buffer messages that share a grouped_id
                    if CONFIG.live.album_sync and message.grouped_id:
                        album_buffer[message.grouped_id].append(message)
                        # We don't know when the group ends in iter_messages, so
                        # we process them individually after grouping below.
                        last_id = message.id
                        forward.offset = last_id
                        write_config(CONFIG)
                        time.sleep(CONFIG.past.delay)
                        continue

                    tm = await apply_plugins(message)
                    if not tm:
                        continue
                    st.stored[event_uid] = {}

                    if message.is_reply:
                        r_event = st.DummyEvent(
                            message.chat_id, message.reply_to_msg_id
                        )
                        r_event_uid = st.EventUid(r_event)
                    for d in dest:
                        topic_id = forward.topic_id
                        if message.is_reply and r_event_uid in st.stored:
                            tm.reply_to = st.stored.get(r_event_uid).get(d)
                        fwded_msg = await send_message(d, tm, topic_id=topic_id)
                        if fwded_msg:
                            st.stored[event_uid].update({d: fwded_msg.id})
                    tm.clear()
                    last_id = message.id
                    logging.info("Forwarded message id=%s", last_id)
                    forward.offset = last_id
                    write_config(CONFIG)
                    time.sleep(CONFIG.past.delay)

                except FloodWaitError as fwe:
                    logging.info("Sleeping for %s", fwe)
                    await asyncio.sleep(delay=fwe.seconds)
                except Exception as err:
                    logging.exception(err)

            # Flush any remaining album groups
            for group_id, msgs in album_buffer.items():
                if not msgs:
                    continue
                try:
                    for d in dest:
                        topic_id = forward.topic_id
                        await send_album(d, client, msgs, topic_id=topic_id)
                    time.sleep(CONFIG.past.delay)
                except FloodWaitError as fwe:
                    logging.info("Sleeping for %s (album flush)", fwe)
                    await asyncio.sleep(delay=fwe.seconds)
                except Exception as err:
                    logging.exception(err)
