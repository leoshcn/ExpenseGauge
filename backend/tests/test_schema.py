"""The migrations build exactly the schema the models describe, and the exported
OpenAPI document matches the app."""

import json
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import app.models  # noqa: F401
from alembic import command
from app.db import Base, get_engine
from tests.conftest import alembic_config
from tests.test_auth import API

BACKEND_DIR = Path(__file__).resolve().parent.parent


def test_migrations_match_models():
    with get_engine().connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert diff == []


def test_money_is_numeric_and_constraints_hold(client, ledger):
    with get_engine().connect() as connection:
        types = dict(
            connection.execute(
                text(
                    "SELECT table_name || '.' || column_name, data_type || '(' ||"
                    " numeric_precision || ',' || numeric_scale || ')'"
                    " FROM information_schema.columns WHERE column_name = 'amount'"
                )
            ).all()
        )
    assert types == {"budgets.amount": "numeric(14,2)", "transactions.amount": "numeric(14,2)"}

    budget = "INSERT INTO budgets (category_id, effective_from, amount) VALUES"
    statements = [
        # amount must not be zero
        "INSERT INTO transactions (account_id, category_id, date, amount, counterparty,"
        f" description, fingerprint) VALUES ({ledger.account_id}, {ledger.metro},"
        " '2026-01-01', 0, 'x', '', 'f')",
        # budgets are non-negative and start on the first of a month
        f"{budget} ({ledger.metro}, '2026-01-01', -1)",
        f"{budget} ({ledger.metro}, '2026-01-15', 1)",
        # level-1 names are unique per account although parent_id is NULL
        "INSERT INTO categories (account_id, parent_id, name)"
        f" VALUES ({ledger.account_id}, NULL, '餐饮')",
    ]
    for statement in statements:
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text(statement))
    # A NULL amount (a cleared budget) and zero are both allowed.
    with get_engine().begin() as connection:
        connection.execute(text(f"{budget} ({ledger.metro}, '2026-01-01', NULL)"))
        connection.execute(text(f"{budget} ({ledger.metro}, '2026-02-01', 0)"))


def test_0002_applies_to_a_database_that_already_has_budgets(client, ledger):
    """Upgrading 0001 -> 0002 keeps the existing budget rows and then allows clearing.
    The downgrade works too, dropping the clearing rows the old schema cannot hold."""
    insert = "INSERT INTO budgets (category_id, effective_from, amount) VALUES"

    def stored() -> list[tuple]:
        with get_engine().connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT category_id, effective_from::text, amount::text FROM budgets"
                    " ORDER BY category_id, effective_from"
                )
            )
            return [tuple(row) for row in rows]

    def amount_is_nullable() -> bool:
        with get_engine().connect() as connection:
            return connection.scalar(
                text(
                    "SELECT is_nullable = 'YES' FROM information_schema.columns"
                    " WHERE table_name = 'budgets' AND column_name = 'amount'"
                )
            )

    existing = [
        (ledger.groceries, "2026-01-01", "1000.00"),
        (ledger.groceries, "2026-06-01", "1200.50"),
        (ledger.metro, "2026-01-01", "0.00"),
    ]
    config = alembic_config()
    get_engine().dispose()  # no pooled connection may sit in the way of ALTER TABLE
    try:
        command.downgrade(config, "0001")
        assert amount_is_nullable() is False
        with get_engine().begin() as connection:
            for category_id, month, amount in existing:
                connection.execute(text(f"{insert} ({category_id}, '{month}', {amount})"))
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text(f"{insert} ({ledger.dining}, '2026-01-01', NULL)"))

        command.upgrade(config, "0002")
        assert amount_is_nullable() is True
        assert stored() == existing
        command.upgrade(config, "head")  # the models need the later revisions too

        # The application works on the upgraded rows: read, then clear from a month.
        budgets = f"{ledger.base}/budgets"
        before = client.get(budgets, params={"month": "2026-07"}).json()["budgets"]
        assert [line["amount"] for line in before] == ["1200.50", None, "0.00"]
        ledger.set_budgets("2026-07", {ledger.groceries: None})
        after = client.get(budgets, params={"month": "2026-07"}).json()["budgets"]
        assert [line["amount"] for line in after] == [None, None, "0.00"]
        assert stored() == [*existing[:2], (ledger.groceries, "2026-07-01", None), existing[2]]

        get_engine().dispose()
        command.downgrade(config, "0001")
        assert amount_is_nullable() is False
        assert stored() == existing
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")
    assert amount_is_nullable() is True


def test_0003_adds_category_description_to_existing_categories(client, ledger):
    """Upgrading 0002 -> 0003 gives existing categories a NULL description; the downgrade
    drops the column (and its text) and leaves the categories working."""

    def has_description_column() -> bool:
        with get_engine().connect() as connection:
            return bool(
                connection.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.columns"
                        " WHERE table_name = 'categories' AND column_name = 'description'"
                    )
                )
            )

    config = alembic_config()
    tree_url = f"{ledger.base}/categories"
    get_engine().dispose()
    try:
        command.downgrade(config, "0002")
        assert has_description_column() is False

        command.upgrade(config, "0003")
        assert has_description_column() is True
        children = [
            c for node in client.get(tree_url).json()["categories"] for c in node["children"]
        ]
        assert [(c["name"], c["description"]) for c in children] == [
            ("买菜", None),
            ("外食", None),
            ("地铁", None),
        ]
        described = client.patch(f"{API}/categories/{ledger.metro}", json={"description": "通勤"})
        assert described.json()["description"] == "通勤"

        get_engine().dispose()
        command.downgrade(config, "0002")
        assert has_description_column() is False
        with get_engine().connect() as connection:
            names = connection.scalars(text("SELECT name FROM categories ORDER BY id")).all()
        assert names == ["餐饮", "买菜", "外食", "交通", "地铁"]
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")
    assert has_description_column() is True
    assert client.get(tree_url).json()["categories"][1]["children"][0]["description"] is None


def test_exported_openapi_document_is_current(app):
    """`backend/openapi.json` is the frontend's contract; regenerate it with
    `uv run python -m scripts.export_openapi` after changing the API."""
    exported = json.loads((BACKEND_DIR / "openapi.json").read_text(encoding="utf-8"))
    assert exported == json.loads(json.dumps(app.openapi()))


def test_openapi_documents_the_error_envelope(app):
    document = app.openapi()
    assert set(document["components"]["schemas"]["ErrorEnvelope"]["properties"]) == {
        "code",
        "message",
        "details",
    }
    for path, operations in document["paths"].items():
        for method, operation in operations.items():
            if path.endswith("/health"):
                continue
            for status in ("default", "422"):
                schema = operation["responses"][status]["content"]["application/json"]["schema"]
                assert schema == {"$ref": "#/components/schemas/ErrorEnvelope"}, (method, path)
    assert "HTTPValidationError" not in document["components"]["schemas"]
