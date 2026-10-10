"""Writes the OpenAPI document to `backend/openapi.json` without starting a server
or touching the database.

    uv run python -m scripts.export_openapi
"""

import json
from pathlib import Path

from app.main import app

TARGET = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> None:
    text = json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    with TARGET.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print(f"wrote {TARGET}")


if __name__ == "__main__":
    main()
