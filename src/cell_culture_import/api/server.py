from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn

from .app import create_app


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="culture-api")
    parser.add_argument("--data-lake", type=Path, default=Path("data_lake"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    uvicorn.run(create_app(args.data_lake), host=args.host, port=args.port)
