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
from app.db import Base, get_engine

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
