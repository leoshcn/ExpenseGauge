"""Test fixtures. Every test runs against a real PostgreSQL, never SQLite.

- `TEST_DATABASE_URL` set: that database is used. Its name must contain "test" because
  the `public` schema is dropped and recreated.
- unset: an embedded PostgreSQL (the `pgserver` dev dependency, real server binaries) is
  started for the test session with its data directory in `backend/.pgdata/`.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command

BACKEND_DIR = Path(__file__).resolve().parent.parent
TEST_DB_NAME = "expense_gauge_test"
PASSWORD = "correct-horse-battery"
API = "/api/v1"

TABLES = (
    "transactions, budgets, categories, payment_channels, budget_accounts, app_settings,"
    " api_tokens, sessions, users, ai_settings, ai_insights, deleted_transactions, schedules,"
    " saved_reports"
)


def _normalize(url: str) -> str:
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def _embedded_database_url() -> Iterator[str]:
    import pgserver

    data_dir = BACKEND_DIR / ".pgdata" / "test"
    data_dir.parent.mkdir(exist_ok=True)
    server = pgserver.get_server(data_dir, cleanup_mode="stop")
    try:
        admin_url = _normalize(server.get_uri())
        admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
            )
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
        admin.dispose()
        yield make_url(admin_url).set(database=TEST_DB_NAME).render_as_string(hide_password=False)
    finally:
        server.cleanup()


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    configured = os.environ.get("TEST_DATABASE_URL")
    if configured:
        url = _normalize(configured)
        if "test" not in (make_url(url).database or ""):
            pytest.exit(
                "TEST_DATABASE_URL must point at a database whose name contains 'test': "
                "the test session drops and recreates its public schema.",
                returncode=2,
            )
        yield url
    else:
        yield from _embedded_database_url()


def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.attributes["configure_logging"] = False
    return config


@pytest.fixture(scope="session", autouse=True)
def migrated_database(database_url: str) -> Iterator[str]:
    """Points the app at the test database and builds the schema with Alembic."""
    os.environ["DATABASE_URL"] = database_url
    os.environ["LOGIN_FAILURE_DELAY_SECONDS"] = "0"

    from app.config import get_settings
    from app.db import get_engine, get_sessionmaker

    for cached in (get_settings, get_engine, get_sessionmaker):
        cached.cache_clear()

    engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    engine.dispose()

    command.upgrade(alembic_config(), "head")

    yield database_url
    get_engine().dispose()


@pytest.fixture(autouse=True)
def clean_tables(migrated_database: str) -> None:
    from app.db import get_engine

    with get_engine().begin() as connection:
        connection.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))


@pytest.fixture(scope="session")
def app(migrated_database: str):
    from app.main import app as application

    return application


@pytest.fixture
def anon(app) -> TestClient:
    """A client with no credentials."""
    return TestClient(app)


@pytest.fixture
def client(app) -> TestClient:
    """A client signed in as the (only) user through the session cookie."""
    signed_in = TestClient(app)
    response = signed_in.post("/api/v1/setup", json={"username": "owner", "password": PASSWORD})
    assert response.status_code == 201, response.text
    return signed_in


def make_token(client: TestClient, name: str = "hermes") -> dict:
    response = client.post("/api/v1/tokens", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def token(client: TestClient) -> dict:
    return make_token(client)


@pytest.fixture
def agent(app, token: dict) -> TestClient:
    """A client that authenticates only with an agent token."""
    return TestClient(app, headers={"Authorization": f"Bearer {token['token']}"})


class Ledger:
    """A set-up ledger: base currency, one budget account ("日常"), one payment channel
    ("储蓄卡") and a small global two-level category tree whose level-2 categories all
    belong to "日常"."""

    def __init__(self, client: TestClient, currency: str = "CNY") -> None:
        self.client = client
        settings = client.put(f"{API}/settings", json={"currency": currency})
        assert settings.status_code == 200, settings.text
        self.daily = self.budget_account("日常")
        self.channel = self.add_channel("储蓄卡")
        self.food = self.category("餐饮")
        self.groceries = self.category("买菜", self.food)
        self.dining = self.category("外食", self.food)
        self.transport = self.category("交通")
        self.metro = self.category("地铁", self.transport)

    def budget_account(self, name: str, period: str | None = None) -> int:
        """A monthly budget account, or one of `period` ("month" / "year") when given."""
        body = {"name": name} if period is None else {"name": name, "period": period}
        response = self.client.post(f"{API}/budget-accounts", json=body)
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def add_channel(self, name: str) -> int:
        response = self.client.post(f"{API}/channels", json={"name": name})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def category(
        self, name: str, parent_id: int | None = None, budget_account_id: int | None = None
    ) -> int:
        """Level 1 without `parent_id`; level 2 defaults to the "日常" budget account."""
        body: dict = {"name": name, "parent_id": parent_id}
        if parent_id is not None:
            body["budget_account_id"] = budget_account_id or self.daily
        response = self.client.post(f"{API}/categories", json=body)
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def item(self, **overrides) -> dict:
        item = {
            "date": "2026-09-15",
            "amount": "35.50",
            "counterparty": "盒马鲜生",
            "description": "支付宝消费",
            "category_id": self.groceries,
        }
        item.update(overrides)
        return item

    def batch_url(self, channel_id: int | None = None) -> str:
        return f"{API}/channels/{channel_id or self.channel}/transactions/batch"

    def submit(
        self,
        items: list[dict],
        client: TestClient | None = None,
        channel_id: int | None = None,
    ):
        return (client or self.client).post(self.batch_url(channel_id), json={"items": items})

    def set_budgets(self, effective_from: str, amounts: dict[int, str | None]):
        """Sets budgets from a month; an amount of None clears the budget from that month."""
        response = self.client.put(
            f"{API}/budgets",
            json={
                "effective_from": effective_from,
                "items": [{"category_id": k, "amount": v} for k, v in amounts.items()],
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    def count(self, **filters) -> int:
        return self.client.get(f"{API}/transactions", params=filters).json()["total"]


@pytest.fixture
def ledger(client: TestClient) -> Ledger:
    return Ledger(client)
