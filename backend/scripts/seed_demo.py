"""Fills a running local API with demo data, through the public REST API only.

    uv run python -m scripts.dev_server --reset      # terminal 1
    uv run python -m scripts.seed_demo               # terminal 2

Creates the user (or signs in as it), the base currency (CNY), four budget accounts
(one of them annual, with a yearly budget and a few large payments),
four payment channels, a global two-level category tree in Chinese, budgets with one
mid-range change, and nine months of transactions ending today: refunds, over-budget
categories, unbudgeted categories, a budget account with no transactions and fixed
bills paid from several channels. Foreign-currency spending is stored converted to CNY,
as an agent would submit it. The data is generated from a fixed seed, so every run gives
the same figures for the same date.

Does nothing if the database already has budget accounts; start the dev server with
`--reset` to seed again. Development only: the password below is public.
"""

import argparse
import calendar
import random
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import httpx

USERNAME = "demo"
PASSWORD = "expense-gauge-demo"
MONTHS = 9
SEED = 20261010


@dataclass(frozen=True)
class Tx:
    day: int
    amount: Decimal
    counterparty: str
    description: str
    note: str | None = None


def add_months(first: date, count: int) -> date:
    index = first.year * 12 + first.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def month_key(first: date) -> str:
    return f"{first.year:04d}-{first.month:02d}"


class Api:
    def __init__(self, base_url: str) -> None:
        self.http = httpx.Client(base_url=base_url.rstrip("/") + "/api/v1", timeout=30)

    def call(self, method: str, path: str, expect: int, **kwargs) -> dict | list:
        response = self.http.request(method, path, **kwargs)
        if response.status_code != expect:
            sys.exit(f"{method} {path} -> {response.status_code}: {response.text}")
        return response.json()

    def sign_in(self) -> None:
        credentials = {"username": USERNAME, "password": PASSWORD}
        created = self.http.post("/setup", json=credentials)
        if created.status_code == 201:
            return
        if created.status_code != 409:
            sys.exit(f"POST /setup -> {created.status_code}: {created.text}")
        signed_in = self.http.post("/auth/login", json=credentials)
        if signed_in.status_code != 200:
            sys.exit(
                "A user other than the demo user already exists. Restart the dev server "
                "with --reset to seed an empty database."
            )


class Ledger:
    """The global category tree (leaves by name), budget accounts and payment channels."""

    def __init__(self, api: Api) -> None:
        self.api = api
        self.leaf: dict[str, int] = {}
        self.budget_accounts: dict[str, int] = {}
        self.channels: dict[str, int] = {}
        self.count: dict[str, int] = {}

    def budget_account(self, name: str, period: str = "month") -> int:
        body = {"name": name, "period": period}
        created = self.api.call("POST", "/budget-accounts", 201, json=body)
        self.budget_accounts[name] = created["id"]
        return created["id"]

    def channel(self, name: str) -> int:
        created = self.api.call("POST", "/channels", 201, json={"name": name})
        self.channels[name] = created["id"]
        self.count[name] = 0
        return created["id"]

    def tree(self, tree: dict[str, list[str]], budget_account_of: dict[str, str]) -> None:
        """Adds level-1 categories and their children; each child goes to the budget
        account `budget_account_of[child]`, "日常" when absent."""
        for parent, children in tree.items():
            parent_id = self._category({"name": parent})
            for child in children:
                account = self.budget_accounts[budget_account_of.get(child, "日常")]
                body = {"name": child, "parent_id": parent_id, "budget_account_id": account}
                self.leaf[child] = self._category(body)

    def _category(self, body: dict) -> int:
        return self.api.call("POST", "/categories", 201, json=body)["id"]

    def set_budgets(self, effective_from: date, amounts: dict[str, str]) -> None:
        items = [{"category_id": self.leaf[k], "amount": v} for k, v in amounts.items()]
        body = {"effective_from": month_key(effective_from), "items": items}
        self.api.call("PUT", "/budgets", 200, json=body)

    def submit(self, first: date, by_leaf: dict[str, list[Tx]], channel_of: dict[str, str]) -> None:
        """One all-or-nothing batch per channel and month; `channel_of[leaf]` says which
        channel paid. The API rejects items with the same date, amount, counterparty and
        description on one channel as suspected duplicates, so repeats that the generator
        happens to produce are dropped here."""
        seen: set[tuple] = set()
        batches: dict[str, list[dict]] = {}
        for leaf, transactions in by_leaf.items():
            channel = channel_of[leaf]
            for tx in transactions:
                key = (channel, tx.day, tx.amount, tx.counterparty, tx.description)
                if key in seen:
                    continue
                seen.add(key)
                batches.setdefault(channel, []).append(
                    {
                        "date": first.replace(day=tx.day).isoformat(),
                        "amount": str(tx.amount),
                        "counterparty": tx.counterparty,
                        "description": tx.description,
                        "category_id": self.leaf[leaf],
                        "note": tx.note,
                    }
                )
        for channel, items in batches.items():
            path = f"/channels/{self.channels[channel]}/transactions/batch"
            self.api.call("POST", path, 201, json={"items": items})
            self.count[channel] += len(items)


class Month:
    """Generators for one month, cut off at `last_day` (today, for the current month)."""

    def __init__(self, rng: random.Random, first: date, last_day: int) -> None:
        self.rng = rng
        self.first = first
        self.last_day = last_day
        self.share = last_day / calendar.monthrange(first.year, first.month)[1]

    def money(self, low: float, high: float, step: str = "0.10") -> Decimal:
        value = Decimal(str(self.rng.uniform(low, high)))
        return (value / Decimal(step)).quantize(Decimal(1)) * Decimal(step) + Decimal("0.00")

    def spread(
        self, count: int, low: float, high: float, merchants: list[str], description: str
    ) -> list[Tx]:
        """`count` purchases over a full month, proportionally fewer in a partial one."""
        result = []
        for _ in range(round(count * self.share)):
            result.append(
                Tx(
                    self.rng.randint(1, self.last_day),
                    self.money(low, high),
                    self.rng.choice(merchants),
                    description,
                )
            )
        return result

    def fixed(self, day: int, amount: str, counterparty: str, description: str, note=None):
        """A dated transaction, or nothing when that day has not come yet."""
        if day > self.last_day:
            return []
        return [Tx(day, Decimal(amount), counterparty, description, note)]


DAILY_TREE = {
    "餐饮": ["买菜", "外食", "咖啡饮品"],
    "交通": ["地铁公交", "打车", "加油停车"],
    "居住": ["房租", "水电燃气", "物业网络"],
    "购物": ["日用品", "服饰", "数码", "礼物人情"],
    "娱乐休闲": ["电影演出", "订阅会员", "旅行"],
    "医疗健康": ["门诊药品", "健身"],
    "宠物": ["猫粮用品", "宠物医院"],
}

# 礼物人情 and the whole of 宠物 are deliberately left without a budget.
DAILY_BUDGETS = {
    "买菜": "1600",
    "外食": "1000",
    "咖啡饮品": "300",
    "地铁公交": "200",
    "打车": "300",
    "加油停车": "600",
    "房租": "6500",
    "水电燃气": "400",
    "物业网络": "350",
    "日用品": "500",
    "服饰": "800",
    "数码": "500",
    "电影演出": "200",
    "订阅会员": "120",
    "旅行": "1000",
    "门诊药品": "300",
    "健身": "250",
}
# Raised three months ago: earlier months keep the amounts above.
DAILY_BUDGET_RAISE = {"买菜": "1800", "外食": "1200"}

# Level-2 categories outside the "日常" budget account.
BUDGET_ACCOUNT_OF = {
    "房租": "固定",
    "水电燃气": "固定",
    "物业网络": "固定",
    "订阅会员": "固定",
    "健身": "固定",
    "软件订阅": "固定",
    "云服务": "固定",
    "机酒交通": "旅行基金",
    "住宿": "旅行基金",
    "保险": "年度",
    "长假旅行": "年度",
}
# Which channel paid each level-2 category; the rest is paid by credit card. Rent and
# utilities come from the savings card yet count in "固定" through their category.
CHANNEL_OF = {
    "房租": "储蓄卡",
    "保险": "储蓄卡",
    "水电燃气": "储蓄卡",
    "物业网络": "储蓄卡",
    "买菜": "支付宝",
    "外食": "支付宝",
    "咖啡饮品": "支付宝",
    "地铁公交": "支付宝",
    "软件订阅": "美元信用卡",
    "云服务": "美元信用卡",
    "电子产品": "美元信用卡",
    "运费关税": "美元信用卡",
}
CREDIT_CARD = "招行信用卡"


def daily_month(m: Month, offset: int) -> dict[str, list[Tx]]:
    """`offset` is 0 for the current month, -1 for the one before, and so on."""
    rng = m.rng
    rides = [
        Tx(
            rng.randint(1, m.last_day),
            Decimal(rng.choice(["3.00", "4.00", "5.00", "6.00"])),
            "上海地铁",
            f"轨道交通 {rng.choice(['08', '09', '18', '19'])}:{rng.randint(0, 59):02d} 进站",
        )
        for _ in range(round(38 * m.share))
    ]
    items: dict[str, list[Tx]] = {
        "买菜": m.spread(
            10, 70, 190, ["盒马鲜生", "叮咚买菜", "永辉超市", "清美鲜食"], "支付宝消费"
        ),
        "外食": m.spread(9, 42, 150, ["海底捞", "西贝莜面村", "和府捞面", "美团外卖"], "微信支付"),
        "咖啡饮品": m.spread(9, 16, 36, ["瑞幸咖啡", "Manner Coffee", "喜茶"], "微信支付"),
        "地铁公交": rides,
        "打车": m.spread(5, 22, 68, ["滴滴出行", "高德打车"], "快车行程"),
        "加油停车": m.spread(2, 180, 320, ["中国石化", "壳牌加油站"], "加油"),
        "房租": m.fixed(1, "6500.00", "自如寓", "月租金"),
        "水电燃气": m.fixed(8, str(m.money(130, 260)), "国网上海电力", "电费")
        + m.fixed(15, str(m.money(60, 150)), "上海燃气", "燃气费"),
        "物业网络": m.fixed(5, "230.00", "万科物业", "物业管理费")
        + m.fixed(5, "99.00", "中国电信", "宽带月费"),
        "日用品": m.spread(4, 35, 150, ["京东", "天猫超市", "名创优品"], "订单支付"),
        "服饰": m.spread(rng.choice([0, 1, 2]), 199, 520, ["优衣库", "无印良品"], "门店消费"),
        "数码": m.spread(rng.choice([0, 1]), 59, 299, ["京东", "Apple Store"], "订单支付"),
        "礼物人情": m.spread(rng.choice([0, 1, 1]), 200, 600, ["微信红包", "花点时间"], "转账"),
        "电影演出": m.spread(rng.choice([1, 2]), 45, 110, ["猫眼电影", "大麦"], "购票"),
        "订阅会员": m.fixed(3, "25.00", "爱奇艺", "会员自动续费")
        + m.fixed(12, "15.00", "网易云音乐", "会员自动续费")
        + m.fixed(20, "30.00", "百度网盘", "会员自动续费"),
        "旅行": [],
        "门诊药品": m.spread(rng.choice([0, 1, 2]), 30, 170, ["叮当快药", "瑞金医院"], "医保自付"),
        "健身": m.fixed(2, "239.00", "超级猩猩", "月卡"),
        "猫粮用品": m.spread(2, 89, 210, ["波奇宠物", "京东"], "订单支付"),
        "宠物医院": [],
    }

    if offset == 0:
        # A holiday month: travel and one dinner push two categories over budget early.
        items["旅行"] = (
            m.fixed(1, "1480.00", "东方航空", "机票 上海-成都", "#国庆成都 出行")
            + m.fixed(2, "1260.00", "携程旅行", "酒店 3 晚", "#国庆成都")
            + m.fixed(3, "320.00", "大熊猫基地", "门票", "#国庆成都")
        )
        items["外食"] += m.fixed(3, "868.00", "蜀九香火锅", "微信支付", "#国庆成都 #聚餐")
        items["数码"] = m.fixed(6, "1299.00", "Apple Store", "AirPods")
        items["服饰"] = m.fixed(5, "399.00", "优衣库", "门店消费") + m.fixed(
            8, "-199.00", "优衣库", "部分退款", "退了一件"
        )
    if offset == -2:
        items["旅行"] = m.fixed(14, "1980.00", "携程旅行", "酒店 2 晚", "#杭州周末") + m.fixed(
            13, "880.00", "中国铁路", "高铁票 往返", "#杭州周末"
        )
        items["宠物医院"] = m.fixed(21, "1180.00", "瑞鹏宠物医院", "体检与疫苗")
    if offset == -3:
        # The refund of last month's purchase: this month's 服饰 actual is negative.
        items["服饰"] = m.fixed(2, "-1280.00", "始祖鸟", "退货退款", "尺码不合适")
    if offset == -4:
        items["服饰"] += m.fixed(27, "1280.00", "始祖鸟", "门店消费")
    if offset == -5:
        items["数码"] = m.fixed(18, "4299.00", "Apple Store", "iPhone 以旧换新")
    return items


# Spending in USD, stored in the base currency (CNY) at a fixed demo rate, the way an
# agent converts at the day's rate before submitting.
USD_TREE = {"订阅服务": ["软件订阅", "云服务"], "海淘": ["电子产品", "运费关税"]}
USD_TO_CNY = Decimal("7.10")
USD_BUDGETS = {"软件订阅": "290", "云服务": "290"}

# A budget account with categories and a budget but no transactions: the Dashboard's
# empty state when it is selected.
FUND_TREE = {"长途旅行": ["机酒交通", "住宿"]}

# The annual budget account "年度": one budget per calendar year (PUT /budgets stores it
# at January whatever month it is saved in), paid in a few large amounts.
ANNUAL_TREE = {"年度开支": ["保险", "长假旅行"]}
ANNUAL_BUDGETS = {"保险": "9000", "长假旅行": "15000"}


def annual_month(m: Month, offset: int) -> dict[str, list[Tx]]:
    items: dict[str, list[Tx]] = {"保险": [], "长假旅行": []}
    if offset == -6:
        items["保险"] = m.fixed(10, "6380.00", "平安保险", "年度重疾险保费")
    if offset == -4:
        items["保险"] = m.fixed(22, "1460.00", "众安保险", "家财险 + 意外险")
    if offset == -1:
        items["长假旅行"] = m.fixed(6, "5200.00", "携程旅行", "日本 机票 + 酒店") + m.fixed(
            12, "2380.00", "携程旅行", "当地行程"
        )
    return items


def usd_month(m: Month, offset: int) -> dict[str, list[Tx]]:
    items = {
        "软件订阅": m.fixed(4, "4.00", "GitHub", "Pro subscription")
        + m.fixed(9, "16.90", "JetBrains", "All Products Pack")
        + m.fixed(9, "2.99", "1Password", "Individual")
        + m.fixed(17, "10.00", "Notion", "Plus plan"),
        "云服务": m.fixed(3, str(m.money(24, 52, "0.01")), "Amazon Web Services", "Monthly usage")
        + m.fixed(3, "5.00", "Cloudflare", "Workers Paid"),
        "电子产品": [],
        "运费关税": [],
    }
    if offset in (-3, -1):
        items["电子产品"] = m.fixed(11, str(m.money(89, 249, "0.01")), "Amazon", "Order")
        items["运费关税"] = m.fixed(16, str(m.money(12, 30, "0.01")), "转运四方", "Shipping")
    return {
        leaf: [
            Tx(
                tx.day,
                (tx.amount * USD_TO_CNY).quantize(Decimal("0.01")),
                tx.counterparty,
                tx.description,
                f"USD {tx.amount}",
            )
            for tx in transactions
        ]
        for leaf, transactions in items.items()
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    # Names are Chinese; a redirected Windows stdout would otherwise garble them.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    api = Api(args.base_url)
    try:
        api.sign_in()
    except httpx.ConnectError:
        sys.exit(f"No API at {args.base_url}. Start it: uv run python -m scripts.dev_server")
    if api.call("GET", "/budget-accounts", 200):
        print(
            "The database already has budget accounts; nothing done. Use dev_server --reset first."
        )
        return

    today = date.today()
    current = today.replace(day=1)
    rng = random.Random(SEED)

    api.call("PUT", "/settings", 200, json={"currency": "CNY"})
    ledger = Ledger(api)
    for name in ("日常", "固定", "旅行基金"):
        ledger.budget_account(name)
    ledger.budget_account("年度", "year")
    for name in ("储蓄卡", CREDIT_CARD, "支付宝", "美元信用卡"):
        ledger.channel(name)
    ledger.tree({**DAILY_TREE, **USD_TREE, **FUND_TREE, **ANNUAL_TREE}, BUDGET_ACCOUNT_OF)
    channel_of = {leaf: CHANNEL_OF.get(leaf, CREDIT_CARD) for leaf in ledger.leaf}

    ledger.set_budgets(add_months(current, -(MONTHS - 1)), DAILY_BUDGETS)
    ledger.set_budgets(add_months(current, -3), DAILY_BUDGET_RAISE)
    ledger.set_budgets(add_months(current, -4), USD_BUDGETS)
    ledger.set_budgets(current, {"机酒交通": "2000", "住宿": "3000"})
    # Annual: the window may start in the previous year, which gets its own version.
    ledger.set_budgets(add_months(current, -(MONTHS - 1)), ANNUAL_BUDGETS)
    ledger.set_budgets(current, ANNUAL_BUDGETS)

    for offset in range(-(MONTHS - 1), 1):
        first = add_months(current, offset)
        days = calendar.monthrange(first.year, first.month)[1]
        month = Month(rng, first, today.day if offset == 0 else days)
        ledger.submit(first, daily_month(month, offset), channel_of)
        ledger.submit(first, annual_month(month, offset), channel_of)
        if offset >= -4:
            ledger.submit(first, usd_month(month, offset), channel_of)

    for name, count in ledger.count.items():
        print(f"channel {ledger.channels[name]}: {name}, {count} transactions")
    print(f"sign in as {USERNAME} / {PASSWORD}")


if __name__ == "__main__":
    main()
