# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

tgcf is a Python CLI tool for automating custom Telegram message forwarding. It uses Telethon (Telegram MTProto client) and is managed with Poetry.

### Python version

This project requires **Python 3.9** due to dependency constraints in the lock file. The pinned versions of `PyYAML`, `cryptg`, and other C-extension packages do not build on Python 3.12. The update script installs Python 3.9 via the deadsnakes PPA and configures Poetry to use it.

### Running commands

All commands should be run via `poetry run` (e.g. `poetry run tgcf --help`). Ensure `$HOME/.local/bin` is in `PATH` so the `poetry` CLI is available.

### Lint

- `poetry run isort --check-only .` — import sorting check
- `poetry run black --check .` — code formatting check
- `make fmt` — auto-fix both isort and black

### Tests

- `poetry run python tests/test_config.py` — runs the config parsing test

### Running the application

The CLI requires Telegram API credentials (`API_ID`, `API_HASH`) and either a `BOT_TOKEN` or `SESSION_STRING`. Without these, the app cannot connect to Telegram.

To verify the CLI works without credentials, use FAKE mode:

```
FAKE=1 API_ID=12345 API_HASH=abcd12345 poetry run tgcf live
```

This exercises the full startup flow (banner, config parsing, mode selection) and exits with a `CRITICAL` log confirming FAKE mode was detected.

### Gotchas

- `setuptools<70` must be installed in the Poetry virtualenv because `pyfiglet` requires `pkg_resources`, which was removed in setuptools 70+. The update script handles this.
- `typed-ast==1.5.5` must be installed in the venv for `black 20.8b1` to work on Python 3.9. The update script handles this.
- The `poetry.lock` file was regenerated for Python 3.9 compatibility and committed. If it conflicts with upstream, re-run `poetry lock` with Python 3.9 active.
