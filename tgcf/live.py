"""The module responsible for operating tgcf in live mode."""

import logging
from typing import Optional, Union

from telethon import TelegramClient, events, functions, types
from telethon.errors import ChatForwardsRestrictedError
from telethon.tl.custom.message import Message

from tgcf import config, const
from tgcf import storage as st
from tgcf.bot import get_events
from tgcf.plugins import apply_plugins
from tgcf.utils import send_album, send_message


def _get_topic_id(chat_id: int, dest: int) -> Optional[int]:
    """Return the forum topic_id configured for (chat_id → dest), or None."""
    for fwd in config.CONFIG.forwards:
        try:
            src_id = next(
                k for k, v in config.from_to.items() if k == chat_id and dest in v
            )
        except StopIteration:
            continue
        if src_id == chat_id:
            return fwd.topic_id
    return None


async def new_message_handler(event: Union[Message, events.NewMessage]) -> None:
    """Process new incoming messages."""
    chat_id = event.chat_id

    if chat_id not in config.from_to:
        return
    logging.info("New message received in %s", chat_id)
    message = event.message

    event_uid = st.EventUid(event)

    length = len(st.stored)
    exceeding = length - const.KEEP_LAST_MANY

    if exceeding > 0:
        for key in st.stored:
            del st.stored[key]
            break

    dest = config.from_to.get(chat_id)

    tm = await apply_plugins(message)
    if not tm:
        return

    if event.is_reply:
        r_event = st.DummyEvent(chat_id, event.reply_to_msg_id)
        r_event_uid = st.EventUid(r_event)

    st.stored[event_uid] = {}
    for d in dest:
        topic_id = _get_topic_id(chat_id, d)
        if event.is_reply and r_event_uid in st.stored:
            tm.reply_to = st.stored.get(r_event_uid).get(d)
        fwded_msg = await send_message(d, tm, topic_id=topic_id)
        if fwded_msg:
            st.stored[event_uid].update({d: fwded_msg})
    tm.clear()


async def album_handler(event) -> None:
    """Handle grouped media (album) messages."""
    chat_id = event.chat_id

    if chat_id not in config.from_to:
        return

    logging.info("Album received in %s", chat_id)
    dest = config.from_to.get(chat_id)
    messages = event.messages

    for d in dest:
        topic_id = _get_topic_id(chat_id, d)
        try:
            await send_album(
                d,
                event.client,
                messages,
                topic_id=topic_id,
            )
        except Exception as err:
            logging.error("Failed to forward album to %s: %s", d, err)


async def edited_message_handler(event) -> None:
    """Handle message edits."""
    message = event.message
    chat_id = event.chat_id

    if chat_id not in config.from_to:
        return

    logging.info("Message edited in %s", chat_id)

    event_uid = st.EventUid(event)

    tm = await apply_plugins(message)

    if not tm:
        return

    fwded_msgs = st.stored.get(event_uid)

    if fwded_msgs:
        for _, msg in fwded_msgs.items():
            if config.CONFIG.live.delete_on_edit == message.text:
                await msg.delete()
                await message.delete()
            else:
                try:
                    await msg.edit(tm.text)
                except Exception as err:
                    logging.warning("Edit sync failed: %s", err)
        return

    dest = config.from_to.get(chat_id)

    for d in dest:
        topic_id = _get_topic_id(chat_id, d)
        await send_message(d, tm, topic_id=topic_id)
    tm.clear()


async def deleted_message_handler(event) -> None:
    """Handle message deletes."""
    chat_id = event.chat_id
    if chat_id not in config.from_to:
        return

    logging.info("Message deleted in %s", chat_id)

    event_uid = st.EventUid(event)
    fwded_msgs = st.stored.get(event_uid)
    if fwded_msgs:
        for _, msg in fwded_msgs.items():
            try:
                await msg.delete()
            except Exception as err:
                logging.warning("Delete sync failed: %s", err)


async def reaction_handler(event) -> None:
    """Mirror reactions from source to destination messages."""
    chat_id = event.chat_id
    if chat_id not in config.from_to:
        return

    logging.info("Reaction event in %s", chat_id)

    r_event = st.DummyEvent(chat_id, event.msg_id)
    r_event_uid = st.EventUid(r_event)
    fwded_msgs = st.stored.get(r_event_uid)
    if not fwded_msgs:
        return

    # Collect the current reactions list from the event
    reactions = getattr(event, "reactions", None)
    if not reactions:
        return

    new_reactions = [r.reaction for r in (reactions.results or [])]

    for _, msg in fwded_msgs.items():
        try:
            await msg.client(
                functions.messages.SendReactionRequest(
                    peer=msg.peer_id,
                    msg_id=msg.id,
                    reaction=new_reactions,
                )
            )
        except Exception as err:
            logging.warning("Reaction sync failed: %s", err)


async def pin_handler(event) -> None:
    """Sync pin/unpin actions to forwarded messages."""
    chat_id = event.chat_id
    if chat_id not in config.from_to:
        return

    action = event.action_message
    if not action:
        return

    pinned_msg_id = getattr(action, "reply_to_msg_id", None)
    if pinned_msg_id is None:
        return

    r_event = st.DummyEvent(chat_id, pinned_msg_id)
    r_event_uid = st.EventUid(r_event)
    fwded_msgs = st.stored.get(r_event_uid)
    if not fwded_msgs:
        return

    for _, msg in fwded_msgs.items():
        try:
            await msg.client.pin_message(msg.peer_id, msg.id)
        except Exception as err:
            logging.warning("Pin sync failed: %s", err)


ALL_EVENTS: dict = {
    "new": (new_message_handler, events.NewMessage()),
    "edited": (edited_message_handler, events.MessageEdited()),
    "deleted": (deleted_message_handler, events.MessageDeleted()),
}


async def start_sync() -> None:
    """Start tgcf live sync."""

    client = TelegramClient(config.SESSION, config.API_ID, config.API_HASH)
    await client.start(bot_token=config.BOT_TOKEN)
    config.is_bot = await client.is_bot()
    logging.info("config.is_bot=%s", config.is_bot)
    command_events = get_events()

    await config.load_admins(client)

    ALL_EVENTS.update(command_events)

    for key, val in ALL_EVENTS.items():
        if config.CONFIG.live.delete_sync is False and key == "deleted":
            continue
        client.add_event_handler(*val)
        logging.info("Added event handler for %s", key)

    # Album handler
    if config.CONFIG.live.album_sync:
        client.add_event_handler(album_handler, events.Album())
        logging.info("Added album event handler")

    # Reaction sync
    if config.CONFIG.live.react_sync:
        client.add_event_handler(reaction_handler, events.MessageReaction())
        logging.info("Added reaction event handler")

    # Pin sync
    if config.CONFIG.live.pin_sync:
        client.add_event_handler(pin_handler, events.ChatAction())
        logging.info("Added pin event handler")

    if config.is_bot and const.REGISTER_COMMANDS:
        await client(
            functions.bots.SetBotCommandsRequest(
                scope=types.BotCommandScopeDefault(),
                lang_code="",
                commands=[
                    types.BotCommand(command=key, description=value)
                    for key, value in const.COMMANDS.items()
                ],
            )
        )
    config.from_to = await config.load_from_to(client, config.CONFIG.forwards)
    await client.run_until_disconnected()
