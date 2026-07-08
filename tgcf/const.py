"""Declare all global constants."""

COMMANDS = {
    "start": "Check whether I am alive",
    "forward": "Set a new forward",
    "remove": "Remove an existing forward",
    "topic": "Set a forum topic ID for the last forward destination",
    "style": "Set text style for forwarded messages",
    "protect": "Toggle content-protection on forwarded messages",
    "help": "Learn usage",
}

REGISTER_COMMANDS = True

KEEP_LAST_MANY = 10000

CONFIG_FILE_NAME = "tgcf.config.yml"
CONFIG_ENV_VAR_NAME = "TGCF_CONFIG"


class BotMessages:
    """Messages given by the bot to users."""

    start = "Hi! I am alive and ready to forward messages."
    bot_help = (
        "📖 tgcf — Telegram message forwarder\n\n"
        "Commands:\n"
        "/forward — Add a new forwarding rule\n"
        "/remove  — Remove a forwarding rule\n"
        "/topic   — Set forum topic ID for a forward destination\n"
        "/style   — Set text formatting style\n"
        "/protect — Toggle content protection\n"
        "/help    — Show this message\n\n"
        "Docs: https://github.com/aahnik/tgcf/wiki"
    )
