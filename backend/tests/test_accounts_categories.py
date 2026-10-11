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
                    {"id": ledger.groceries, "name": "买菜", "description": None},
                    {"id": ledger.dining, "name": "外食", "description": None},
                ],
            },
            {
                "id": ledger.transport,
                "name": "交通",
                "children": [{"id": ledger.metro, "name": "地铁", "description": None}],
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
        "description": None,
    }
    clash = client.patch(f"{API}/categories/{ledger.dining}", json={"name": "买菜"})
    assert_envelope(clash, 409, "CATEGORY_NAME_TAKEN")
    assert_envelope(
        client.patch(f"{API}/categories/999", json={"name": "x"}), 404, "CATEGORY_NOT_FOUND"
    )


def test_level2_category_description(client, agent, ledger):
    """Create with a description, then partial PATCH: name only, description only, clear."""
    base = ledger.base
    created = client.post(
        f"{base}/categories",
        json={"name": "超市", "parent_id": ledger.food, "description": "  线下商超\n不含外卖  "},
    )
    assert created.status_code == 201, created.text
    market = created.json()
    assert market["description"] == "线下商超\n不含外卖"  # trimmed, newline kept
    # Blank is stored as null.
    blank = client.post(
        f"{base}/categories", json={"name": "零食", "parent_id": ledger.food, "description": " "}
    )
    assert blank.json()["description"] is None

    url = f"{API}/categories/{market['id']}"
    renamed = client.patch(url, json={"name": "商超"})
    assert renamed.json() == {**market, "name": "商超"}  # description untouched
    described = client.patch(url, json={"description": "含便利店"})
    assert described.json() == {**market, "name": "商超", "description": "含便利店"}
    both = client.patch(url, json={"name": "超市", "description": "线下商超"})
    assert both.json() == {**market, "description": "线下商超"}

    # The tree, as an agent token sees it too, carries the description of level 2 only.
    tree = agent.get(f"{base}/categories").json()["categories"]
    assert tree[0]["children"][2] == {"id": market["id"], "name": "超市", "description": "线下商超"}
    assert "description" not in tree[0]

    for cleared_with in (None, "", "   "):
        assert client.patch(url, json={"description": "x"}).status_code == 200
        cleared = client.patch(url, json={"description": cleared_with})
        assert cleared.json()["description"] is None
    assert client.get(f"{base}/categories").json()["categories"][0]["children"][2] == {
        "id": market["id"],
        "name": "超市",
        "description": None,
    }

    # 500 characters is the limit; newlines are allowed.
    at_limit = client.patch(url, json={"description": "说" * 250 + "\n" + "明" * 249})
    assert at_limit.status_code == 200, at_limit.text
    too_long = client.patch(url, json={"description": "说" * 501})
    assert_envelope(too_long, 422, "VALIDATION_ERROR")
    too_long_new = client.post(
        f"{base}/categories",
        json={"name": "长", "parent_id": ledger.food, "description": "说" * 501},
    )
    assert_envelope(too_long_new, 422, "VALIDATION_ERROR")
    assert_envelope(client.patch(url, json={"description": "a\x00b"}), 422, "VALIDATION_ERROR")

    # An empty body, a null name and unknown fields are refused.
    assert_envelope(client.patch(url, json={}), 422, "VALIDATION_ERROR")
    assert_envelope(client.patch(url, json={"name": None}), 422, "VALIDATION_ERROR")
    assert_envelope(client.patch(url, json={"parent_id": 1}), 422, "VALIDATION_ERROR")
    assert_envelope(
        client.patch(f"{API}/categories/999", json={"description": "x"}), 404, "CATEGORY_NOT_FOUND"
    )


def test_level1_category_has_no_description(client, ledger):
    """Level 1 refuses a non-blank description, on create and on update."""
    base = ledger.base
    created = client.post(f"{base}/categories", json={"name": "居家", "description": "房租水电"})
    assert_envelope(created, 422, "DESCRIPTION_NOT_ALLOWED")
    names = [c["name"] for c in client.get(f"{base}/categories").json()["categories"]]
    assert names == ["餐饮", "交通"]

    url = f"{API}/categories/{ledger.food}"
    assert_envelope(client.patch(url, json={"description": "x"}), 422, "DESCRIPTION_NOT_ALLOWED")
    # Refused as a whole: the name in the same request is not applied.
    refused = client.patch(url, json={"name": "吃饭", "description": "x"})
    assert_envelope(refused, 422, "DESCRIPTION_NOT_ALLOWED")
    assert client.get(f"{base}/categories").json()["categories"][0]["name"] == "餐饮"

    # Null or blank is "no description", which level 1 already has.
    for blank in (None, "", " "):
        response = client.patch(url, json={"name": "餐饮", "description": blank})
        assert response.status_code == 200, response.text
        assert response.json()["description"] is None
    level1 = client.post(f"{base}/categories", json={"name": "居家", "description": ""})
    assert level1.status_code == 201
    assert level1.json()["description"] is None


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
