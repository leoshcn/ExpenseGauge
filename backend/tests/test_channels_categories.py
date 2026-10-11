"""Settings (base currency), budget accounts, payment channels, AC6 (category tree),
AC15 (delete only when unused), R2 (global two-level rules and budget account ownership)."""

from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope


def test_base_currency_is_set_once_and_relabelled_later(client):
    """D7/D11: one base currency for the whole ledger. Until it is set, anything that
    reports a currency answers SETTINGS_NOT_INITIALIZED; changing it converts nothing."""
    assert client.get(f"{API}/settings").json() == {"currency": None}
    for path in ("budgets", "summary/monthly", "summary/months/2026-09"):
        assert_envelope(client.get(f"{API}/{path}"), 409, "SETTINGS_NOT_INITIALIZED")

    assert_envelope(
        client.put(f"{API}/settings", json={"currency": "RMBX"}), 422, "VALIDATION_ERROR"
    )
    assert_envelope(client.put(f"{API}/settings", json={}), 422, "VALIDATION_ERROR")
    assert client.put(f"{API}/settings", json={"currency": " cny "}).json() == {"currency": "CNY"}
    assert client.get(f"{API}/settings").json() == {"currency": "CNY"}
    assert client.get(f"{API}/budgets").json()["currency"] == "CNY"

    ledger = Ledger(client, currency="CNY")
    ledger.set_budgets("2026-09", {ledger.groceries: "100"})
    assert client.put(f"{API}/settings", json={"currency": "USD"}).json() == {"currency": "USD"}
    budgets = client.get(f"{API}/budgets", params={"month": "2026-09"}).json()
    assert budgets["currency"] == "USD"
    assert budgets["budgets"][0]["amount"] == "100.00"  # relabelled, not converted


def test_setting_budgets_without_a_currency_writes_nothing(client):
    budget_account = client.post(f"{API}/budget-accounts", json={"name": "日常"}).json()
    level1 = client.post(f"{API}/categories", json={"name": "餐饮"}).json()
    leaf = client.post(
        f"{API}/categories",
        json={"name": "买菜", "parent_id": level1["id"], "budget_account_id": budget_account["id"]},
    ).json()
    body = {"effective_from": "2026-09", "items": [{"category_id": leaf["id"], "amount": "1"}]}
    assert_envelope(client.put(f"{API}/budgets", json=body), 409, "SETTINGS_NOT_INITIALIZED")
    client.put(f"{API}/settings", json={"currency": "CNY"})
    budgets = client.get(f"{API}/budgets", params={"month": "2026-09"}).json()["budgets"]
    assert budgets[0]["amount"] is None


def test_budget_accounts_create_list_rename(client):
    created = client.post(f"{API}/budget-accounts", json={"name": " 固定 "})
    assert created.status_code == 201
    fixed = created.json()
    assert fixed == {"id": fixed["id"], "name": "固定"}

    duplicate = client.post(f"{API}/budget-accounts", json={"name": "固定"})
    assert_envelope(duplicate, 409, "BUDGET_ACCOUNT_NAME_TAKEN")
    daily = client.post(f"{API}/budget-accounts", json={"name": "日常"}).json()
    clash = client.patch(f"{API}/budget-accounts/{daily['id']}", json={"name": "固定"})
    assert_envelope(clash, 409, "BUDGET_ACCOUNT_NAME_TAKEN")

    renamed = client.patch(f"{API}/budget-accounts/{fixed['id']}", json={"name": "固定支出"})
    assert renamed.json() == {"id": fixed["id"], "name": "固定支出"}
    assert client.get(f"{API}/budget-accounts").json() == [renamed.json(), daily]
    # Budget accounts carry no currency of their own.
    extra = client.post(f"{API}/budget-accounts", json={"name": "x", "currency": "USD"})
    assert_envelope(extra, 422, "VALIDATION_ERROR")
    assert_envelope(
        client.patch(f"{API}/budget-accounts/999", json={"name": "x"}),
        404,
        "BUDGET_ACCOUNT_NOT_FOUND",
    )
    # Budget accounts cannot be deleted.
    response = client.delete(f"{API}/budget-accounts/{fixed['id']}")
    assert_envelope(response, 405, "METHOD_NOT_ALLOWED")


def test_channels_create_list_rename(client, agent):
    created = client.post(f"{API}/channels", json={"name": " 招行信用卡 "})
    assert created.status_code == 201
    card = created.json()
    assert card == {"id": card["id"], "name": "招行信用卡"}

    assert_envelope(
        client.post(f"{API}/channels", json={"name": "招行信用卡"}), 409, "CHANNEL_NAME_TAKEN"
    )
    extra = client.post(f"{API}/channels", json={"name": "x", "currency": "USD"})
    assert_envelope(extra, 422, "VALIDATION_ERROR")

    renamed = client.patch(f"{API}/channels/{card['id']}", json={"name": "招行"})
    assert renamed.json() == {"id": card["id"], "name": "招行"}
    wallet = client.post(f"{API}/channels", json={"name": "支付宝"}).json()
    # Listed by id, to the user and to an agent token alike.
    assert client.get(f"{API}/channels").json() == [renamed.json(), wallet]
    assert agent.get(f"{API}/channels").json() == [renamed.json(), wallet]
    assert_envelope(
        client.patch(f"{API}/channels/999", json={"name": "x"}), 404, "CHANNEL_NOT_FOUND"
    )
    # Agents only read channels; channels cannot be deleted.
    assert_envelope(agent.post(f"{API}/channels", json={"name": "x"}), 403, "TOKEN_SCOPE_FORBIDDEN")
    assert_envelope(client.delete(f"{API}/channels/{card['id']}"), 405, "METHOD_NOT_ALLOWED")


def test_category_tree_is_global_with_budget_accounts_on_level2(client, agent, ledger):
    """AC6/D1: one global tree, also to an agent token. Level 2 shows its budget account."""
    daily = {"id": ledger.daily, "name": "日常"}
    expected = {
        "budget_account_id": None,
        "categories": [
            {
                "id": ledger.food,
                "name": "餐饮",
                "children": [
                    {
                        "id": ledger.groceries,
                        "name": "买菜",
                        "description": None,
                        "budget_account": daily,
                    },
                    {
                        "id": ledger.dining,
                        "name": "外食",
                        "description": None,
                        "budget_account": daily,
                    },
                ],
            },
            {
                "id": ledger.transport,
                "name": "交通",
                "children": [
                    {
                        "id": ledger.metro,
                        "name": "地铁",
                        "description": None,
                        "budget_account": daily,
                    }
                ],
            },
        ],
    }
    assert client.get(f"{API}/categories").json() == expected
    assert agent.get(f"{API}/categories").json() == expected


def test_tree_filtered_by_budget_account(client, ledger):
    """A budget account's view: its level-2 categories under their level-1 parents only."""
    fixed = ledger.budget_account("固定")
    housing = ledger.category("居住")
    rent = ledger.category("房租", housing, fixed)
    repair = ledger.category("维修", housing, ledger.daily)
    ledger.category("空的")  # a level 1 without children

    def tree(budget_account_id: int | None) -> list[tuple[str, list[str]]]:
        params = {} if budget_account_id is None else {"budget_account_id": budget_account_id}
        body = client.get(f"{API}/categories", params=params).json()
        assert body["budget_account_id"] == budget_account_id
        return [(n["name"], [c["name"] for c in n["children"]]) for n in body["categories"]]

    assert tree(None) == [
        ("餐饮", ["买菜", "外食"]),
        ("交通", ["地铁"]),
        ("居住", ["房租", "维修"]),
        ("空的", []),
    ]
    assert tree(fixed) == [("居住", ["房租"])]
    assert tree(ledger.daily) == [
        ("餐饮", ["买菜", "外食"]),
        ("交通", ["地铁"]),
        ("居住", ["维修"]),
    ]

    # Moving a category changes the views at once.
    moved = client.patch(f"{API}/categories/{repair}", json={"budget_account_id": fixed})
    assert moved.json() == {
        "id": repair,
        "parent_id": housing,
        "name": "维修",
        "description": None,
        "budget_account_id": fixed,
    }
    assert tree(fixed) == [("居住", ["房租", "维修"])]
    assert tree(ledger.daily) == [("餐饮", ["买菜", "外食"]), ("交通", ["地铁"])]
    assert rent != repair
    unknown = client.get(f"{API}/categories", params={"budget_account_id": 999})
    assert_envelope(unknown, 422, "BUDGET_ACCOUNT_NOT_FOUND")


def test_level2_needs_a_valid_budget_account_level1_refuses_one(client, ledger):
    """R2 / acceptance: a level-2 category without a budget account, or with one that
    does not exist, is refused; so is a level-1 category with one."""
    missing = client.post(f"{API}/categories", json={"name": "零食", "parent_id": ledger.food})
    body = assert_envelope(missing, 422, "VALIDATION_ERROR")
    assert body["details"]["errors"][0]["field"] == "body.budget_account_id"
    unknown = client.post(
        f"{API}/categories",
        json={"name": "零食", "parent_id": ledger.food, "budget_account_id": 999},
    )
    assert_envelope(unknown, 422, "BUDGET_ACCOUNT_NOT_FOUND")
    level1 = client.post(
        f"{API}/categories", json={"name": "居住", "budget_account_id": ledger.daily}
    )
    assert_envelope(level1, 422, "BUDGET_ACCOUNT_NOT_ALLOWED")
    names = [n["name"] for n in client.get(f"{API}/categories").json()["categories"]]
    assert names == ["餐饮", "交通"]
    assert len(client.get(f"{API}/categories").json()["categories"][0]["children"]) == 2

    # The same rules on update.
    level1_url = f"{API}/categories/{ledger.food}"
    patched = client.patch(level1_url, json={"budget_account_id": ledger.daily})
    assert_envelope(patched, 422, "BUDGET_ACCOUNT_NOT_ALLOWED")
    leaf_url = f"{API}/categories/{ledger.metro}"
    assert_envelope(
        client.patch(leaf_url, json={"budget_account_id": None}), 422, "VALIDATION_ERROR"
    )
    unknown = client.patch(leaf_url, json={"budget_account_id": 999})
    assert_envelope(unknown, 422, "BUDGET_ACCOUNT_NOT_FOUND")
    # Refused as a whole: the name in the same request is not applied.
    refused = client.patch(leaf_url, json={"name": "公交", "budget_account_id": 999})
    assert_envelope(refused, 422, "BUDGET_ACCOUNT_NOT_FOUND")
    assert client.get(f"{API}/categories").json()["categories"][1]["children"][0]["name"] == "地铁"


def test_category_rules(client, ledger):
    # No third level.
    third = client.post(
        f"{API}/categories",
        json={"name": "早市", "parent_id": ledger.groceries, "budget_account_id": ledger.daily},
    )
    assert_envelope(third, 422, "INVALID_PARENT")
    missing_parent = client.post(
        f"{API}/categories",
        json={"name": "x", "parent_id": 999, "budget_account_id": ledger.daily},
    )
    assert_envelope(missing_parent, 422, "INVALID_PARENT")
    # Level-1 names are unique globally; level-2 names per parent, reusable elsewhere.
    assert_envelope(
        client.post(f"{API}/categories", json={"name": "餐饮"}), 409, "CATEGORY_NAME_TAKEN"
    )
    other = ledger.budget_account("固定")
    same_parent = client.post(
        f"{API}/categories",
        json={"name": "买菜", "parent_id": ledger.food, "budget_account_id": other},
    )
    assert_envelope(same_parent, 409, "CATEGORY_NAME_TAKEN")
    elsewhere = client.post(
        f"{API}/categories",
        json={"name": "买菜", "parent_id": ledger.transport, "budget_account_id": other},
    )
    assert elsewhere.status_code == 201
    assert elsewhere.json()["budget_account_id"] == other

    renamed = client.patch(f"{API}/categories/{ledger.metro}", json={"name": "公共交通"})
    assert renamed.json() == {
        "id": ledger.metro,
        "parent_id": ledger.transport,
        "name": "公共交通",
        "description": None,
        "budget_account_id": ledger.daily,
    }
    clash = client.patch(f"{API}/categories/{ledger.dining}", json={"name": "买菜"})
    assert_envelope(clash, 409, "CATEGORY_NAME_TAKEN")
    level1_clash = client.patch(f"{API}/categories/{ledger.transport}", json={"name": "餐饮"})
    assert_envelope(level1_clash, 409, "CATEGORY_NAME_TAKEN")
    assert_envelope(
        client.patch(f"{API}/categories/999", json={"name": "x"}), 404, "CATEGORY_NOT_FOUND"
    )


def test_level2_category_description(client, agent, ledger):
    """Create with a description, then partial PATCH: name only, description only, clear."""
    created = client.post(
        f"{API}/categories",
        json={
            "name": "超市",
            "parent_id": ledger.food,
            "budget_account_id": ledger.daily,
            "description": "  线下商超\n不含外卖  ",
        },
    )
    assert created.status_code == 201, created.text
    market = created.json()
    assert market["description"] == "线下商超\n不含外卖"  # trimmed, newline kept
    # Blank is stored as null.
    blank = client.post(
        f"{API}/categories",
        json={
            "name": "零食",
            "parent_id": ledger.food,
            "budget_account_id": ledger.daily,
            "description": " ",
        },
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
    tree = agent.get(f"{API}/categories").json()["categories"]
    assert tree[0]["children"][2] == {
        "id": market["id"],
        "name": "超市",
        "description": "线下商超",
        "budget_account": {"id": ledger.daily, "name": "日常"},
    }
    assert "description" not in tree[0]

    for cleared_with in (None, "", "   "):
        assert client.patch(url, json={"description": "x"}).status_code == 200
        cleared = client.patch(url, json={"description": cleared_with})
        assert cleared.json()["description"] is None
    assert (
        client.get(f"{API}/categories").json()["categories"][0]["children"][2]["description"]
        is None
    )

    # 500 characters is the limit; newlines are allowed.
    at_limit = client.patch(url, json={"description": "说" * 250 + "\n" + "明" * 249})
    assert at_limit.status_code == 200, at_limit.text
    too_long = client.patch(url, json={"description": "说" * 501})
    assert_envelope(too_long, 422, "VALIDATION_ERROR")
    too_long_new = client.post(
        f"{API}/categories",
        json={
            "name": "长",
            "parent_id": ledger.food,
            "budget_account_id": ledger.daily,
            "description": "说" * 501,
        },
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
    created = client.post(f"{API}/categories", json={"name": "居家", "description": "房租水电"})
    assert_envelope(created, 422, "DESCRIPTION_NOT_ALLOWED")
    names = [c["name"] for c in client.get(f"{API}/categories").json()["categories"]]
    assert names == ["餐饮", "交通"]

    url = f"{API}/categories/{ledger.food}"
    assert_envelope(client.patch(url, json={"description": "x"}), 422, "DESCRIPTION_NOT_ALLOWED")
    # Refused as a whole: the name in the same request is not applied.
    refused = client.patch(url, json={"name": "吃饭", "description": "x"})
    assert_envelope(refused, 422, "DESCRIPTION_NOT_ALLOWED")
    assert client.get(f"{API}/categories").json()["categories"][0]["name"] == "餐饮"

    # Null or blank is "no description", which level 1 already has.
    for blank in (None, "", " "):
        response = client.patch(url, json={"name": "餐饮", "description": blank})
        assert response.status_code == 200, response.text
        assert response.json()["description"] is None
    level1 = client.post(f"{API}/categories", json={"name": "居家", "description": ""})
    assert level1.status_code == 201
    assert level1.json() == {
        "id": level1.json()["id"],
        "parent_id": None,
        "name": "居家",
        "description": None,
        "budget_account_id": None,
    }


def test_category_in_use_cannot_be_deleted_unused_can(client, ledger):
    """AC15: "in use" counts transactions from every channel."""
    card = ledger.add_channel("信用卡")
    assert (
        ledger.submit([ledger.item(category_id=ledger.groceries)], channel_id=card).status_code
        == 201
    )

    in_use = client.delete(f"{API}/categories/{ledger.groceries}")
    assert_envelope(in_use, 409, "CATEGORY_IN_USE")
    has_children = client.delete(f"{API}/categories/{ledger.food}")
    assert_envelope(has_children, 409, "CATEGORY_HAS_CHILDREN")

    # Unused level 2 (even with a budget), then its now-empty level 1.
    ledger.set_budgets("2026-09", {ledger.metro: "100"})
    assert client.delete(f"{API}/categories/{ledger.metro}").status_code == 204
    assert client.delete(f"{API}/categories/{ledger.transport}").status_code == 204
    tree = client.get(f"{API}/categories").json()["categories"]
    assert [node["name"] for node in tree] == ["餐饮"]
    assert [child["id"] for child in tree[0]["children"]] == [ledger.groceries, ledger.dining]

    # Once its transaction is gone the category is unused again.
    transaction_id = client.get(f"{API}/transactions").json()["items"][0]["id"]
    assert client.delete(f"{API}/transactions/{transaction_id}").status_code == 204
    assert client.delete(f"{API}/categories/{ledger.groceries}").status_code == 204
    assert_envelope(
        client.delete(f"{API}/categories/{ledger.groceries}"), 404, "CATEGORY_NOT_FOUND"
    )
