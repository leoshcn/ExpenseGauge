"""Accounts, AC6 (category tree), AC15 (delete only when unused), two-level rules."""

from tests.test_auth import API, assert_envelope


def test_accounts_create_list_rename(client):
    created = client.post(f"{API}/accounts", json={"name": " 招行信用卡 ", "currency": "cny"})
    assert created.status_code == 201
    account = created.json()
    assert account == {"id": account["id"], "name": "招行信用卡", "currency": "CNY"}

    duplicate = client.post(f"{API}/accounts", json={"name": "招行信用卡", "currency": "USD"})
    assert_envelope(duplicate, 409, "ACCOUNT_NAME_TAKEN")
    bad = client.post(f"{API}/accounts", json={"name": "x", "currency": "RMBX"})
    assert_envelope(bad, 422, "VALIDATION_ERROR")

    renamed = client.patch(f"{API}/accounts/{account['id']}", json={"name": "招行"})
    assert renamed.json()["name"] == "招行"
    # Currency is fixed at creation.
    locked = client.patch(
        f"{API}/accounts/{account['id']}", json={"name": "招行", "currency": "USD"}
    )
    assert_envelope(locked, 422, "VALIDATION_ERROR")
    assert client.get(f"{API}/accounts").json() == [{**account, "name": "招行"}]
    assert_envelope(
        client.patch(f"{API}/accounts/999", json={"name": "x"}), 404, "ACCOUNT_NOT_FOUND"
    )
    # Accounts cannot be deleted.
    assert_envelope(client.delete(f"{API}/accounts/{account['id']}"), 405, "METHOD_NOT_ALLOWED")


def test_category_tree_is_two_level_and_per_account(client, agent, ledger):
    """AC6: list_categories returns the full two-level tree, also to an agent token."""
    expected = {
        "account_id": ledger.account_id,
        "categories": [
            {
                "id": ledger.food,
                "name": "餐饮",
                "children": [
                    {"id": ledger.groceries, "name": "买菜"},
                    {"id": ledger.dining, "name": "外食"},
                ],
            },
            {
                "id": ledger.transport,
                "name": "交通",
                "children": [{"id": ledger.metro, "name": "地铁"}],
            },
        ],
    }
    assert client.get(f"{ledger.base}/categories").json() == expected
    assert agent.get(f"{ledger.base}/categories").json() == expected

    other = client.post(f"{API}/accounts", json={"name": "另一个账户", "currency": "USD"}).json()
    assert client.get(f"{API}/accounts/{other['id']}/categories").json() == {
        "account_id": other["id"],
        "categories": [],
    }
    assert_envelope(agent.get(f"{API}/accounts/999/categories"), 404, "ACCOUNT_NOT_FOUND")


def test_category_rules(client, ledger):
    base = ledger.base
    # No third level.
    third = client.post(f"{base}/categories", json={"name": "早市", "parent_id": ledger.groceries})
    assert_envelope(third, 422, "INVALID_PARENT")
    # Parent must belong to the same account.
    other = client.post(f"{API}/accounts", json={"name": "另一个账户", "currency": "CNY"}).json()
    cross = client.post(
        f"{API}/accounts/{other['id']}/categories", json={"name": "x", "parent_id": ledger.food}
    )
    assert_envelope(cross, 422, "INVALID_PARENT")
    # Names are unique per level and parent, and reusable elsewhere.
    assert_envelope(
        client.post(f"{base}/categories", json={"name": "餐饮"}), 409, "CATEGORY_NAME_TAKEN"
    )
    same_parent = client.post(f"{base}/categories", json={"name": "买菜", "parent_id": ledger.food})
    assert_envelope(same_parent, 409, "CATEGORY_NAME_TAKEN")
    elsewhere = client.post(
        f"{base}/categories", json={"name": "买菜", "parent_id": ledger.transport}
    )
    assert elsewhere.status_code == 201

    renamed = client.patch(f"{API}/categories/{ledger.metro}", json={"name": "公共交通"})
    assert renamed.json() == {
        "id": ledger.metro,
        "account_id": ledger.account_id,
        "parent_id": ledger.transport,
        "name": "公共交通",
    }
    clash = client.patch(f"{API}/categories/{ledger.dining}", json={"name": "买菜"})
    assert_envelope(clash, 409, "CATEGORY_NAME_TAKEN")
    assert_envelope(
        client.patch(f"{API}/categories/999", json={"name": "x"}), 404, "CATEGORY_NOT_FOUND"
    )


def test_category_in_use_cannot_be_deleted_unused_can(client, ledger):
    """AC15"""
    assert ledger.submit([ledger.item(category_id=ledger.groceries)]).status_code == 201

    in_use = client.delete(f"{API}/categories/{ledger.groceries}")
    assert_envelope(in_use, 409, "CATEGORY_IN_USE")
    has_children = client.delete(f"{API}/categories/{ledger.food}")
    assert_envelope(has_children, 409, "CATEGORY_HAS_CHILDREN")

    # Unused level 2 (even with a budget), then its now-empty level 1.
    ledger.set_budgets("2026-09", {ledger.metro: "100"})
    assert client.delete(f"{API}/categories/{ledger.metro}").status_code == 204
    assert client.delete(f"{API}/categories/{ledger.transport}").status_code == 204
    tree = client.get(f"{ledger.base}/categories").json()["categories"]
    assert [node["name"] for node in tree] == ["餐饮"]
    assert [child["id"] for child in tree[0]["children"]] == [ledger.groceries, ledger.dining]

    # Once its transaction is gone the category is unused again.
    transaction_id = client.get(f"{ledger.base}/transactions").json()["items"][0]["id"]
    assert client.delete(f"{API}/transactions/{transaction_id}").status_code == 204
    assert client.delete(f"{API}/categories/{ledger.groceries}").status_code == 204
    assert_envelope(
        client.delete(f"{API}/categories/{ledger.groceries}"), 404, "CATEGORY_NOT_FOUND"
    )
