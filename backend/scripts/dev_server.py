"""Runs the API for local development on an embedded PostgreSQL: no Docker and no
database install. The data lives in `backend/.pgdata/dev/` (git-ignored) and survives
restarts.

    uv run python -m scripts.dev_server              # http://127.0.0.1:8000
    uv run python -m scripts.dev_server --reset      # start from an empty database

Development only. Deployments use the `db` container and `DATABASE_URL` instead.
"""

import argparse
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEV_DB_NAME = "expense_gauge_dev"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--reset", action="store_true", help="drop every table of the dev database first"
    )
    args = parser.parse_args()

    import pgserver
    import uvicorn
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    from alembic import command

    data_dir = BACKEND_DIR / ".pgdata" / "dev"
    data_dir.parent.mkdir(exist_ok=True)
    server = pgserver.get_server(data_dir, cleanup_mode="stop")
    try:
        admin_url = make_url(server.get_uri()).set(drivername="postgresql+psycopg")
        admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": DEV_DB_NAME}
            )
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{DEV_DB_NAME}"'))
        admin.dispose()

        database_url = admin_url.set(database=DEV_DB_NAME).render_as_string(hide_password=False)
        # Set before `app` is imported: the settings are read once and cached.
        os.environ["DATABASE_URL"] = database_url

        if args.reset:
            engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
            with engine.connect() as connection:
                connection.execute(text("DROP SCHEMA public CASCADE"))
                connection.execute(text("CREATE SCHEMA public"))
            engine.dispose()
            print("dev database reset")

        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        command.upgrade(config, "head")

        print(f"embedded PostgreSQL data: {data_dir}")
        uvicorn.run("app.main:app", host=args.host, port=args.port)
    finally:
        server.cleanup()


if __name__ == "__main__":
    main()
