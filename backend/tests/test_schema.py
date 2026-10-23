"""The migrations build exactly the schema the models describe, and the exported
OpenAPI document matches the app."""

import json
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

import app.models  # noqa: F401
from alembic import command
from app.db import Base, get_engine
from tests.conftest import Ledger, alembic_config
from tests.test_auth import API

BACKEND_DIR = Path(__file__).resolve().parent.parent

BUSINESS_TABLES = (
    "transactions",
    "budgets",
    "categories",
    "payment_channels",
    "budget_accounts",
    "app_settings",
)


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
    assert types == {
        "budgets.amount": "numeric(14,2)",
        "transactions.amount": "numeric(14,2)",
        "schedules.amount": "numeric(14,2)",
    }

    budget = "INSERT INTO budgets (category_id, effective_from, amount) VALUES"
    category = (
        "INSERT INTO categories (position, parent_id, name, budget_account_id, description) VALUES"
    )
    statements = [
        # amount must not be zero
        "INSERT INTO transactions (channel_id, category_id, date, amount, counterparty,"
        f" description, fingerprint) VALUES ({ledger.channel}, {ledger.metro},"
        " '2026-01-01', 0, 'x', '', 'f')",
        # budgets are non-negative and start on the first of a month
        f"{budget} ({ledger.metro}, '2026-01-01', -1)",
        f"{budget} ({ledger.metro}, '2026-01-15', 1)",
        # level-1 names are unique globally although parent_id is NULL
        f"{category} (9,NULL, '餐饮', NULL, NULL)",
        # level 1 has neither a budget account nor a description
        f"{category} (9,NULL, '居住', {ledger.daily}, NULL)",
        f"{category} (9,NULL, '居住', NULL, '说明')",
        # level 2 always has a budget account
        f"{category} (9,{ledger.food}, '零食', NULL, NULL)",
        # one settings row only
        "INSERT INTO app_settings (id, currency) VALUES (2, 'USD')",
    ]
    for statement in statements:
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text(statement))
    # A NULL amount (a cleared budget) and zero are both allowed.
    with get_engine().begin() as connection:
        connection.execute(text(f"{budget} ({ledger.metro}, '2026-01-01', NULL)"))
        connection.execute(text(f"{budget} ({ledger.metro}, '2026-02-01', 0)"))
        connection.execute(text(f"{category} (9,{ledger.food}, '零食', {ledger.daily}, '说明')"))


def _insert_0001_ledger(connection) -> None:
    """An account with a small category tree, as the 0001-0003 schema stores it."""
    connection.execute(
        text("INSERT INTO accounts (id, name, currency) VALUES (1, '日常账户', 'CNY')")
    )
    connection.execute(
        text(
            "INSERT INTO categories (id, account_id, parent_id, name) VALUES"
            " (1, 1, NULL, '餐饮'), (2, 1, 1, '买菜'), (3, 1, 1, '外食'),"
            " (4, 1, NULL, '交通'), (5, 1, 4, '地铁')"
        )
    )


def test_0002_applies_to_a_database_that_already_has_budgets(client):
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

    groceries, dining, metro = 2, 3, 5
    existing = [
        (groceries, "2026-01-01", "1000.00"),
        (groceries, "2026-06-01", "1200.50"),
        (metro, "2026-01-01", "0.00"),
    ]
    config = alembic_config()
    get_engine().dispose()  # no pooled connection may sit in the way of ALTER TABLE
    try:
        command.downgrade(config, "0001")
        assert amount_is_nullable() is False
        with get_engine().begin() as connection:
            _insert_0001_ledger(connection)
            for category_id, month, amount in existing:
                connection.execute(text(f"{insert} ({category_id}, '{month}', {amount})"))
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text(f"{insert} ({dining}, '2026-01-01', NULL)"))

        command.upgrade(config, "0002")
        assert amount_is_nullable() is True
        assert stored() == existing
        with get_engine().begin() as connection:  # a clearing version
            connection.execute(text(f"{insert} ({groceries}, '2026-07-01', NULL)"))
        assert stored() == [*existing[:2], (groceries, "2026-07-01", None), existing[2]]

        get_engine().dispose()
        command.downgrade(config, "0001")
        assert amount_is_nullable() is False
        assert stored() == existing
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")
    assert amount_is_nullable() is True


def test_0003_adds_category_description_to_existing_categories(client):
    """Upgrading 0002 -> 0003 gives existing categories a NULL description; the downgrade
    drops the column (and its text) and leaves the categories in place."""

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
    get_engine().dispose()
    try:
        command.downgrade(config, "0002")
        assert has_description_column() is False
        with get_engine().begin() as connection:
            _insert_0001_ledger(connection)

        command.upgrade(config, "0003")
        assert has_description_column() is True
        with get_engine().begin() as connection:
            rows = connection.execute(text("SELECT name, description FROM categories ORDER BY id"))
            assert [tuple(row) for row in rows] == [
                ("餐饮", None),
                ("买菜", None),
                ("外食", None),
                ("交通", None),
                ("地铁", None),
            ]
            connection.execute(text("UPDATE categories SET description = '通勤' WHERE id = 5"))

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


def _count(table: str) -> int:
    with get_engine().connect() as connection:
        return connection.scalar(text(f"SELECT count(*) FROM {table}"))


def _table_exists(name: str) -> bool:
    with get_engine().connect() as connection:
        return connection.scalar(text("SELECT to_regclass(:name) IS NOT NULL"), {"name": name})


def test_0004_rebuilds_business_tables_and_keeps_users_and_tokens(app, client, token):
    """Acceptance (R1, D8): on a database holding 0003 data `upgrade head` succeeds, the
    business tables are empty and the user, the session and the agent token still work.
    The (lossy) downgrade works on a populated 0004 database too."""
    config = alembic_config()
    get_engine().dispose()
    try:
        command.downgrade(config, "0003")
        assert _table_exists("accounts") and not _table_exists("payment_channels")
        with get_engine().begin() as connection:
            _insert_0001_ledger(connection)
            connection.execute(text("UPDATE categories SET description = '通勤' WHERE id = 5"))
            connection.execute(
                text(
                    "INSERT INTO budgets (category_id, effective_from, amount) VALUES"
                    " (2, '2026-01-01', 1000), (2, '2026-06-01', NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO transactions (account_id, category_id, date, amount,"
                    " counterparty, description, fingerprint, api_token_id) VALUES"
                    " (1, 2, '2026-09-15', 35.50, '盒马', '', 'f', :token_id)"
                ),
                {"token_id": token["id"]},
            )

        command.upgrade(config, "head")
        assert not _table_exists("accounts")
        assert {table: _count(table) for table in BUSINESS_TABLES} == dict.fromkeys(
            BUSINESS_TABLES, 0
        )
        assert (_count("users"), _count("sessions"), _count("api_tokens")) == (1, 1, 1)

        # The session cookie and the agent token survive the upgrade.
        assert client.get(f"{API}/auth/me").json()["username"] == "owner"
        agent = TestClient(app, headers={"Authorization": f"Bearer {token['token']}"})
        assert agent.get(f"{API}/channels").json() == []
        assert agent.get(f"{API}/categories").json() == {
            "budget_account_id": None,
            "categories": [],
        }
        assert client.get(f"{API}/settings").json() == {"currency": None}

        # The new schema is usable straight away, by the user and by the agent.
        ledger = Ledger(client)
        assert ledger.submit([ledger.item()], client=agent).status_code == 201
        assert ledger.count() == 1

        get_engine().dispose()
        command.downgrade(config, "0003")
        assert _table_exists("accounts") and not _table_exists("payment_channels")
        assert (_count("transactions"), _count("categories"), _count("accounts")) == (0, 0, 0)
        assert (_count("users"), _count("api_tokens")) == (1, 1)
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")
    assert _table_exists("payment_channels")


def test_0005_makes_existing_budget_accounts_monthly(client):
    """AC1 (R1.3): upgrading 0004 -> 0005 keeps budget accounts, categories, budgets and
    transactions and makes every budget account monthly; only month/year are accepted.
    The downgrade drops the period and nothing else."""

    def snapshot() -> list:
        with get_engine().connect() as connection:
            return [
                [tuple(row) for row in connection.execute(text(f"SELECT * FROM {t} ORDER BY id"))]
                for t in ("budget_accounts", "categories", "budgets", "transactions")
            ]

    config = alembic_config()
    get_engine().dispose()
    try:
        command.downgrade(config, "0004")
        with get_engine().begin() as connection:
            connection.execute(
                text("INSERT INTO budget_accounts (id, name) VALUES (1, '日常'), (2, '固定')")
            )
            connection.execute(text("INSERT INTO payment_channels (id, name) VALUES (1, '储蓄卡')"))
            connection.execute(
                text(
                    "INSERT INTO categories (id, parent_id, name, budget_account_id) VALUES"
                    " (1, NULL, '餐饮', NULL), (2, 1, '买菜', 1), (3, 1, '外食', 2)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO budgets (category_id, effective_from, amount) VALUES"
                    " (2, '2026-01-01', 1000), (2, '2026-06-01', NULL), (3, '2026-03-01', 0)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO transactions (channel_id, category_id, date, amount,"
                    " counterparty, description, fingerprint) VALUES"
                    " (1, 2, '2026-09-15', 35.50, '盒马', '', 'f')"
                )
            )
        before = snapshot()

        command.upgrade(config, "0005")
        after = snapshot()
        assert after[0] == [(1, "日常", "month"), (2, "固定", "month")]
        assert after[1:] == before[1:]
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(
                text("INSERT INTO budget_accounts (name, period) VALUES ('季度', 'quarter')")
            )
        with get_engine().begin() as connection:
            connection.execute(
                text("INSERT INTO budget_accounts (id, name, period) VALUES (3, '年度', 'year')")
            )

        get_engine().dispose()
        command.downgrade(config, "0004")
        downgraded = snapshot()
        assert downgraded[0] == [(1, "日常"), (2, "固定"), (3, "年度")]
        assert downgraded[1:] == before[1:]
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")


def test_0006_keeps_the_order_of_existing_categories(client):
    """AC5 (R1): upgrading 0005 -> 0006 numbers existing categories by id within their
    sibling group, so the tree reads as before; a new category goes last. The downgrade
    drops the column and nothing else."""

    def rows(columns: str) -> list[tuple]:
        with get_engine().connect() as connection:
            result = connection.execute(text(f"SELECT {columns} FROM categories ORDER BY id"))
            return [tuple(row) for row in result]

    config = alembic_config()
    get_engine().dispose()
    try:
        command.downgrade(config, "0005")
        with get_engine().begin() as connection:
            connection.execute(
                text("INSERT INTO budget_accounts (id, name, period) VALUES (1, '日常', 'month')")
            )
            # Ids interleave the two parents, and there is a gap (a deleted category).
            connection.execute(
                text(
                    "INSERT INTO categories (id, parent_id, name, budget_account_id) VALUES"
                    " (1, NULL, '餐饮', NULL), (2, NULL, '交通', NULL), (3, 2, '地铁', 1),"
                    " (4, 1, '买菜', 1), (6, 2, '打车', 1), (7, 1, '外食', 1),"
                    " (8, NULL, '空的', NULL)"
                )
            )
            connection.execute(text("SELECT setval('categories_id_seq', 8)"))
        before = rows("id, parent_id, name, description, budget_account_id")

        command.upgrade(config, "0006")
        assert rows("id, position") == [(1, 0), (2, 1), (3, 0), (4, 0), (6, 1), (7, 1), (8, 2)]
        assert rows("id, parent_id, name, description, budget_account_id") == before
        # The API reads the current models: bring the rest of the schema up to date.
        get_engine().dispose()
        command.upgrade(config, "head")

        def tree() -> list[tuple[str, list[str]]]:
            body = client.get(f"{API}/categories").json()
            return [(n["name"], [c["name"] for c in n["children"]]) for n in body["categories"]]

        assert tree() == [("餐饮", ["买菜", "外食"]), ("交通", ["地铁", "打车"]), ("空的", [])]
        new_child = {"name": "公交", "parent_id": 2, "budget_account_id": 1}
        assert client.post(f"{API}/categories", json=new_child).status_code == 201
        assert client.post(f"{API}/categories", json={"name": "居住"}).status_code == 201
        assert tree() == [
            ("餐饮", ["买菜", "外食"]),
            ("交通", ["地铁", "打车", "公交"]),
            ("空的", []),
            ("居住", []),
        ]
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text("INSERT INTO categories (name) VALUES ('无位置')"))

        get_engine().dispose()
        command.downgrade(config, "0005")
        assert rows("id, parent_id, name, description, budget_account_id")[: len(before)] == before
        with pytest.raises(ProgrammingError), get_engine().connect() as connection:
            connection.execute(text("SELECT position FROM categories"))
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")


def test_0007_leaves_every_refund_unmatched_and_the_figures_unchanged(client):
    """AC10 (R7): upgrading 0006 -> 0007 on a database with payments and refunds keeps
    every row, leaves every refund unmatched and every month's figures as the 0006 sums
    gave them. Only a refund may carry a match. The (lossy) downgrade drops the column."""

    def old_sums() -> dict[tuple[str, int], str]:
        """The pre-0007 rule: a refund counts in its own month and category."""
        with get_engine().connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT to_char(date, 'YYYY-MM'), category_id, SUM(amount)::text"
                    " FROM transactions GROUP BY 1, 2"
                )
            )
            return {(month, category_id): total for month, category_id, total in rows}

    def snapshot() -> list[tuple]:
        with get_engine().connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT id, channel_id, category_id, date, amount, counterparty"
                    " FROM transactions ORDER BY id"
                )
            )
            return [tuple(row) for row in rows]

    config = alembic_config()
    get_engine().dispose()
    try:
        command.downgrade(config, "0006")
        with get_engine().begin() as connection:
            connection.execute(text("INSERT INTO app_settings (id, currency) VALUES (1, 'CNY')"))
            connection.execute(
                text("INSERT INTO budget_accounts (id, name, period) VALUES (1, '日常', 'month')")
            )
            connection.execute(text("INSERT INTO payment_channels (id, name) VALUES (1, '储蓄卡')"))
            connection.execute(
                text(
                    "INSERT INTO categories (id, position, parent_id, name, budget_account_id)"
                    " VALUES (1, 0, NULL, '餐饮', NULL), (2, 0, 1, '买菜', 1), (3, 1, 1, '外食', 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO transactions (id, channel_id, category_id, date, amount,"
                    " counterparty, description, fingerprint) VALUES"
                    " (1, 1, 2, '2026-08-20', 100, '盒马', '', 'a'),"
                    " (2, 1, 3, '2026-09-03', -30, '盒马', '退款', 'b'),"
                    " (3, 1, 3, '2026-09-05', 60, '海底捞', '', 'c'),"
                    " (4, 1, 2, '2026-09-06', -100, '盒马', '退款', 'd')"
                )
            )
            connection.execute(text("SELECT setval('transactions_id_seq', 4)"))
        before_rows, before_sums = snapshot(), old_sums()

        command.upgrade(config, "0007")
        assert snapshot() == before_rows
        with get_engine().connect() as connection:
            assert (
                connection.scalar(
                    text("SELECT count(*) FROM transactions WHERE refund_of_id IS NOT NULL")
                )
                == 0
            )
        # The API reads the current models: bring the rest of the schema up to date.
        get_engine().dispose()
        command.upgrade(config, "head")
        for month in ("2026-08", "2026-09"):
            leaves = {
                child["category_id"]: child["actual"]
                for row in client.get(f"{API}/summary/months/{month}").json()["categories"]
                for child in row["children"]
            }
            assert leaves == {c: before_sums.get((month, c), "0.00") for c in (2, 3)}
        assert client.get(f"{API}/summary/months/2026-09").json()["count"] == 1

        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text("UPDATE transactions SET refund_of_id = 1 WHERE id = 3"))
        matched = client.patch(f"{API}/transactions/2", json={"refund_of_id": 1})
        assert matched.status_code == 200, matched.text
        # ON DELETE RESTRICT backs up the service's 409.
        with pytest.raises(IntegrityError), get_engine().begin() as connection:
            connection.execute(text("DELETE FROM transactions WHERE id = 1"))

        get_engine().dispose()
        command.downgrade(config, "0006")
        assert snapshot() == before_rows
        with pytest.raises(ProgrammingError), get_engine().connect() as connection:
            connection.execute(text("SELECT refund_of_id FROM transactions"))
    finally:
        get_engine().dispose()
        command.upgrade(config, "head")


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
