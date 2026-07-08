"""A bot to control settings for tgcf live mode."""

import logging

import yaml
from telethon import events

from tgcf import config, const, plugins
from tgcf.bot.utils import (
    admin_protect,
    display_forwards,
    get_args,
    get_command_prefix,
    remove_source,
)


@admin_protect
async def forward_command_handler(event):
    """Handle the `/forward` command."""
    notes = """/forward — Add a new forwarding rule.
Example (forward from `a` to `b` and `c`):

```
/forward source: a
dest: [b,c]
```

`a`, `b`, `c` are chat ids.
"""

    try:
        args = get_args(event.message.text)
        if not args:
            raise ValueError(f"{notes}\n{display_forwards(config.CONFIG.forwards)}")

        parsed_args = yaml.safe_load(args)
        forward = config.Forward(**parsed_args)
        try:
            remove_source(forward.source, config.CONFIG.forwards)
        except Exception:
            pass
        config.CONFIG.forwards.append(forward)
        config.from_to = await config.load_from_to(event.client, config.CONFIG.forwards)

        await event.respond("✅ Forward added successfully.")
        config.write_config(config.CONFIG)
    except ValueError as err:
        logging.error(err)
        await event.respond(str(err))

    finally:
        raise events.StopPropagation


@admin_protect
async def remove_command_handler(event):
    """Handle the /remove command."""
    notes = """/remove — Remove a forwarding rule by source chat id.
Example: `/remove source: -100`
"""

    try:
        args = get_args(event.message.text)
        if not args:
            raise ValueError(f"{notes}\n{display_forwards(config.CONFIG.forwards)}")

        parsed_args = yaml.safe_load(args)
        source_to_remove = parsed_args.get("source")
        config.CONFIG.forwards = remove_source(source_to_remove, config.CONFIG.forwards)
        config.from_to = await config.load_from_to(event.client, config.CONFIG.forwards)

        await event.respond("✅ Forward removed successfully.")
        config.write_config(config.CONFIG)
    except ValueError as err:
        logging.error(err)
        await event.respond(str(err))

    finally:
        raise events.StopPropagation


@admin_protect
async def topic_command_handler(event):
    """Handle the /topic command — set a forum topic ID for a forward destination."""
    notes = """/topic — Set a forum topic ID for the most recently added forward.
Example: `/topic 123`
where 123 is the topic ID (first message ID of the topic).
"""

    try:
        args = get_args(event.message.text)
        if not args:
            raise ValueError(notes)

        topic_id = int(args.strip())
        if not config.CONFIG.forwards:
            raise ValueError("No forwards configured yet.")

        # Apply topic_id to the last configured forward
        config.CONFIG.forwards[-1].topic_id = topic_id
        await event.respond(f"✅ Topic ID {topic_id} set for last forward.")
        config.write_config(config.CONFIG)
    except (ValueError, TypeError) as err:
        logging.error(err)
        await event.respond(str(err))

    finally:
        raise events.StopPropagation


@admin_protect
async def style_command_handler(event):
    """Handle the /style command."""
    notes = """/style — Set text formatting style for forwarded messages.
Options: `preserve`, `plain`, `bold`, `italics`, `code`, `strike`
Example: `/style bold`
"""

    try:
        args = get_args(event.message.text)
        if not args:
            raise ValueError(notes)
        _valid = ["bold", "italics", "plain", "strike", "preserve", "code"]
        if args not in _valid:
            raise ValueError(f"Invalid style. Choose from: {_valid}")
        config.CONFIG.plugins.update({"format": {"style": args}})
        plugins.plugins = plugins.load_plugins()
        await event.respond(f"✅ Style set to `{args}`.")
        config.write_config(config.CONFIG)
    except ValueError as err:
        logging.error(err)
        await event.respond(str(err))

    finally:
        raise events.StopPropagation


@admin_protect
async def protect_command_handler(event):
    """Handle the /protect command — toggle content protection."""
    current = config.CONFIG.protect_content
    config.CONFIG.protect_content = not current
    state = "enabled" if config.CONFIG.protect_content else "disabled"
    await event.respond(f"✅ Content protection {state}.")
    config.write_config(config.CONFIG)
    raise events.StopPropagation


async def start_command_handler(event):
    """Handle the /start command."""
    await event.respond(const.BotMessages.start)


async def help_command_handler(event):
    """Handle the /help command."""
    await event.respond(const.BotMessages.bot_help)


def get_events():
    _ = get_command_prefix()
    logging.info("Command prefix is %s", _)
    command_events = {
        "start": (start_command_handler, events.NewMessage(pattern=f"{_}start")),
        "forward": (forward_command_handler, events.NewMessage(pattern=f"{_}forward")),
        "remove": (remove_command_handler, events.NewMessage(pattern=f"{_}remove")),
        "topic": (topic_command_handler, events.NewMessage(pattern=f"{_}topic")),
        "style": (style_command_handler, events.NewMessage(pattern=f"{_}style")),
        "protect": (protect_command_handler, events.NewMessage(pattern=f"{_}protect")),
        "help": (help_command_handler, events.NewMessage(pattern=f"{_}help")),
    }

    return command_events
