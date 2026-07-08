"""This module implements the command line interface for tgcf."""

import asyncio
import logging
import os
import platform
import sys
import time
from enum import Enum
from typing import Optional

import typer
from dotenv import load_dotenv
from pyfiglet import Figlet
from rich import console, traceback
from rich.logging import RichHandler

from tgcf import __version__

load_dotenv(".env")

FAKE = bool(os.getenv("FAKE"))
app = typer.Typer(add_completion=False)

con = console.Console()


def _check_latest_version() -> None:
    """Check PyPI for a newer tgcf release and warn the user if one exists."""
    try:
        import urllib.request
        import json

        url = "https://pypi.org/pypi/tgcf/json"
        with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310
            data = json.loads(resp.read())
        latest = data["info"]["version"]
        if latest != __version__:
            con.print(
                f"[bold yellow]tgcf {latest} is available! "
                f"You are running {__version__}.\n"
                "Visit https://github.com/aahnik/tgcf to update.[/bold yellow]"
            )
    except Exception:
        pass  # network unavailable or PyPI down — silently skip


def topper():
    fig = Figlet(font="speed")
    rendered = fig.renderText("tgcf")
    time_passed = 0

    while time_passed < 5:
        cmd = "clear" if os.name == "posix" else "cls"
        os.system(cmd)  # noqa: S605
        if time_passed % 2 == 0:
            print(rendered)
        else:
            con.print(rendered)
        time.sleep(0.5)
        time_passed += 1
    _check_latest_version()
    print("\n")


class Mode(str, Enum):
    """tgcf works in two modes."""

    PAST = "past"
    LIVE = "live"


def verbosity_callback(value: bool):
    """Set logging level."""
    traceback.install()
    if value:
        level = logging.INFO
    else:
        level = logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(message)s",
        handlers=[
            RichHandler(
                rich_tracebacks=True,
                markup=True,
            )
        ],
    )
    topper()
    logging.info("Verbosity turned on! This is suitable for debugging")
    nl = "\n"
    logging.info(
        "Running tgcf %s\nPython %s\nOS %s\nPlatform %s %s\n%s %s",
        __version__,
        sys.version.replace(nl, ""),
        os.name,
        platform.system(),
        platform.release(),
        platform.architecture(),
        platform.processor(),
    )


def version_callback(value: bool):
    """Show current version and exit."""

    if value:
        con.print(__version__)
        raise typer.Exit()


@app.command()
def main(
    mode: Mode = typer.Argument(
        ..., help="Choose the mode in which you want to run tgcf.", envvar="TGCF_MODE"
    ),
    verbose: Optional[bool] = typer.Option(
        None,
        "--loud",
        "-l",
        callback=verbosity_callback,
        envvar="LOUD",
        help="Increase output verbosity.",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        "-v",
        callback=version_callback,
        help="Show version and exit.",
    ),
):
    """The ultimate tool to automate custom telegram message forwarding.

    Source Code: https://github.com/aahnik/tgcf

    For updates join telegram channel @aahniks_code
    """
    if FAKE:
        logging.critical("You are running fake with %s mode", mode)
        sys.exit(1)

    if mode == Mode.PAST:
        from tgcf.past import forward_job  # noqa: PLC0415

        asyncio.run(forward_job())
    else:
        from tgcf.live import start_sync  # noqa: PLC0415

        asyncio.run(start_sync())
