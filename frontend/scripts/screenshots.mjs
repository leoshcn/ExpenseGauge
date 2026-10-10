// Captures the app against a running, freshly seeded local stack into docs/screenshots/.
// Prerequisites (see README.md): backend dev server, `seed_demo`, and `npm run dev`.
//
//   npm run screenshots                    # everything
//   npm run screenshots -- dashboard       # only the Dashboard
//   npm run screenshots -- transactions budgets settings
//
// Nothing here changes data: dialogs are opened and cancelled, the token shown after
// "创建令牌" comes from a stubbed response, and the category delete is one the backend
// refuses.
//
// Uses Playwright's Chromium if it is installed (`npx playwright install chromium`),
// otherwise the Microsoft Edge that ships with Windows.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const BASE = process.env.EG_BASE_URL ?? "http://localhost:5173";
const USERNAME = process.env.EG_USERNAME ?? "demo";
const PASSWORD = process.env.EG_PASSWORD ?? "expense-gauge-demo";
const OUT = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const THEMES = ["light", "dark"];
const SECTIONS = process.argv.slice(2);
const want = (section) => SECTIONS.length === 0 || SECTIONS.includes(section);

async function launch() {
  try {
    return { browser: await chromium.launch(), label: "Playwright Chromium" };
  } catch {
    return { browser: await chromium.launch({ channel: "msedge" }), label: "Microsoft Edge" };
  }
}

async function open(browser, viewport, theme) {
  const context = await browser.newContext({ ...VIEWPORTS[viewport], locale: "zh-CN", colorScheme: theme });
  await context.addInitScript((value) => localStorage.setItem("eg-theme", value), theme);
  const login = await context.request.post(`${BASE}/api/v1/auth/login`, {
    data: { username: USERNAME, password: PASSWORD },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`  console error: ${message.text()}`);
  });
  return { context, page };
}

// Grows the viewport to the page's height instead of using `fullPage`, so the fixed
// sidebar and tab bar sit where they would on a screen of that size.
async function capture(page, name) {
  const original = page.viewportSize();
  await page.evaluate(() => document.fonts.ready);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: original.width, height: Math.max(height, original.height) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await page.setViewportSize(original);
  console.log(`wrote docs/screenshots/${name}.png`);
}

// Dialogs and popovers: the screen as it is, without growing the viewport (a resize
// would close an open select, and a dialog belongs in the middle of a normal screen).
async function captureScreen(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`wrote docs/screenshots/${name}.png`);
}

const ready = (page) => page.locator(".recharts-bar-rectangle").first().waitFor();

await mkdir(OUT, { recursive: true });
const { browser, label } = await launch();
console.log(`browser: ${label} ${browser.version()}`);

if (want("dashboard")) {
for (const viewport of Object.keys(VIEWPORTS)) {
  for (const theme of THEMES) {
    const { context, page } = await open(browser, viewport, theme);
    await page.goto(`${BASE}/dashboard`);
    await ready(page);
    await capture(page, `dashboard-${viewport}-${theme}`);

    // Level-1 rows opened to their level-2 rows.
    await page.getByRole("button", { name: "全部展开" }).click();
    await capture(page, `dashboard-${viewport}-${theme}-expanded`);
    await context.close();
  }
}

// States, in one theme each: other accounts, a month with a negative actual, failures.
for (const viewport of Object.keys(VIEWPORTS)) {
  const { context, page } = await open(browser, viewport, "light");
  const accounts = await (await context.request.get(`${BASE}/api/v1/accounts`)).json();
  const byName = (name) => accounts.find((account) => account.name === name)?.id;

  const usd = byName("美元信用卡");
  if (usd) {
    await page.goto(`${BASE}/dashboard?account=${usd}`);
    await ready(page);
    await capture(page, `dashboard-${viewport}-usd-account`);
  }
  const empty = byName("旅行基金");
  if (empty) {
    await page.goto(`${BASE}/dashboard?account=${empty}`);
    await page.getByText("还没有流水").waitFor();
    await capture(page, `dashboard-${viewport}-empty`);
  }

  // Three months back: a refund makes one category's actual negative.
  await page.goto(`${BASE}/dashboard`);
  await ready(page);
  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "上一个月" }).click();
  await page.locator("[aria-busy=false]").waitFor();
  await page.getByRole("button", { name: "全部展开" }).click();
  await capture(page, `dashboard-${viewport}-refund-month`);

  // The API failing: the error envelope's message and code are shown with a retry.
  await page.route("**/api/v1/accounts/*/summary/**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "INTERNAL_ERROR", message: "服务器内部错误", details: {} }),
    }),
  );
  await page.goto(`${BASE}/dashboard`);
  await page.getByText("数据加载失败").waitFor();
  await capture(page, `dashboard-${viewport}-error`);
  await context.close();
}

// Loading skeleton: hold the summary requests open.
{
  const { context, page } = await open(browser, "desktop", "light");
  await page.route("**/api/v1/accounts/*/summary/**", () => {});
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("status").waitFor();
  await capture(page, "dashboard-desktop-loading");
  await context.close();
}
}

// The page is settled: no request in flight and no skeleton left.
async function settled(page) {
  await page.waitForLoadState("networkidle");
  await page.locator("[role=status][aria-label=\"加载中…\"]").waitFor({ state: "detached" });
  await page.waitForTimeout(150);
}

const failure = (route) =>
  route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ code: "INTERNAL_ERROR", message: "服务器内部错误", details: {} }),
  });

if (want("transactions")) {
  for (const viewport of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      const { context, page } = await open(browser, viewport, theme);
      await page.goto(`${BASE}/transactions`);
      await settled(page);
      await capture(page, `transactions-${viewport}-${theme}`);
      await context.close();
    }
  }
  for (const viewport of Object.keys(VIEWPORTS)) {
    const { context, page } = await open(browser, viewport, "light");
    const accounts = await (await context.request.get(`${BASE}/api/v1/accounts`)).json();
    const tree = await (await context.request.get(`${BASE}/api/v1/accounts/${accounts[0].id}/categories`)).json();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Filtered to this month and one level-1 category.
    await page.goto(`${BASE}/transactions?month=${month}&category=${tree.categories[0].id}`);
    await settled(page);
    await capture(page, `transactions-${viewport}-filtered`);

    // The edit dialog (opened and cancelled), and the delete confirmation.
    await page.goto(`${BASE}/transactions`);
    await settled(page);
    await page.getByRole("button", { name: /^编辑「/ }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").getByRole("combobox", { name: "分类" }).click();
    await page.getByRole("listbox").waitFor();
    await captureScreen(page, `transactions-${viewport}-edit-category`);
    await page.keyboard.press("Escape");
    await captureScreen(page, `transactions-${viewport}-edit`);
    await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
    await page.getByRole("alertdialog").waitFor();
    await captureScreen(page, `transactions-${viewport}-delete`);
    await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click();

    const empty = accounts.find((account) => account.name === "旅行基金");
    if (empty) {
      await page.goto(`${BASE}/transactions?account=${empty.id}`);
      await page.getByText("还没有流水").waitFor();
      await capture(page, `transactions-${viewport}-empty`);
    }
    await page.goto(`${BASE}/transactions?category=${tree.categories.at(-1).children.at(-1).id}&month=2000-01`);
    await page.getByText("没有符合条件的流水").waitFor();
    await capture(page, `transactions-${viewport}-no-match`);
    await context.close();
  }
}

if (want("budgets")) {
  for (const viewport of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      const { context, page } = await open(browser, viewport, theme);
      await page.goto(`${BASE}/budgets`);
      await settled(page);
      await capture(page, `budgets-${viewport}-${theme}`);

      // Unsaved edits: a raise, a cleared budget, a zero budget, a typo; then discard.
      const inputs = page.getByRole("textbox");
      await inputs.nth(0).fill("2000");
      await page.getByRole("button", { name: /^清空「/ }).nth(2).click();
      await page.getByRole("textbox", { name: "「礼物人情」的预算金额" }).fill("0");
      await inputs.nth(4).fill("12.345");
      await capture(page, `budgets-${viewport}-${theme}-editing`);
      await page.getByRole("button", { name: "撤销修改" }).click();
      await context.close();
    }
  }
  for (const viewport of Object.keys(VIEWPORTS)) {
    const { context, page } = await open(browser, viewport, "light");
    // An earlier month: amounts in force then, from older versions.
    await page.goto(`${BASE}/budgets`);
    await settled(page);
    for (let step = 0; step < 5; step += 1) await page.getByRole("button", { name: "上一个月" }).click();
    await settled(page);
    await capture(page, `budgets-${viewport}-earlier-month`);

    await page.route("**/api/v1/accounts/*/budgets**", failure);
    await page.goto(`${BASE}/budgets?month=2001-01`);
    await page.getByText("数据加载失败").waitFor();
    await capture(page, `budgets-${viewport}-error`);
    await context.close();
  }
}

if (want("settings")) {
  for (const viewport of Object.keys(VIEWPORTS)) {
    for (const theme of THEMES) {
      const { context, page } = await open(browser, viewport, theme);
      for (const tab of ["accounts", "categories", "agent"]) {
        await page.goto(`${BASE}/settings?tab=${tab}`);
        await settled(page);
        await capture(page, `settings-${viewport}-${theme}-${tab}`);
      }
      await context.close();
    }
  }
  for (const viewport of Object.keys(VIEWPORTS)) {
    const { context, page } = await open(browser, viewport, "light");

    // A category in use: the backend refuses and its message is shown in the dialog.
    await page.goto(`${BASE}/settings?tab=categories`);
    await settled(page);
    await page.getByRole("button", { name: /^删除「/ }).nth(1).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
    await page.getByRole("alertdialog").getByRole("alert").waitFor();
    await captureScreen(page, `settings-${viewport}-category-in-use`);
    await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click();

    await page.getByRole("button", { name: "添加一级分类" }).click();
    await page.getByRole("dialog").waitFor();
    await captureScreen(page, `settings-${viewport}-category-add`);
    await page.keyboard.press("Escape");

    await page.goto(`${BASE}/settings`);
    await settled(page);
    await page.getByRole("button", { name: "添加账户" }).click();
    await page.getByRole("dialog").waitFor();
    await captureScreen(page, `settings-${viewport}-account-add`);
    await page.keyboard.press("Escape");

    // The token shown once. The response is stubbed so no token is created.
    await page.route("**/api/v1/tokens", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              id: 999,
              name: "Hermes 家里电脑",
              created_at: new Date().toISOString(),
              last_used_at: null,
              revoked_at: null,
              token: "eg_3qX9vT1b-7mKc2YwLr8uHn0ZpJ4sDf6GaEo5iBtNxQk",
            }),
          })
        : route.fallback(),
    );
    await page.goto(`${BASE}/settings?tab=agent`);
    await settled(page);
    await page.getByLabel("令牌名称").fill("Hermes 家里电脑");
    await page.getByRole("button", { name: "创建令牌" }).click();
    await page.getByRole("dialog").waitFor();
    await captureScreen(page, `settings-${viewport}-token-created`);
    await context.close();
  }
}

await browser.close();
