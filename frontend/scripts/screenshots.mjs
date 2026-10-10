// Captures the Dashboard against a running, seeded local stack into docs/screenshots/.
// Prerequisites (see README.md): backend dev server, `seed_demo`, and `npm run dev`.
//
//   npm run screenshots
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

const ready = (page) => page.locator(".recharts-bar-rectangle").first().waitFor();

await mkdir(OUT, { recursive: true });
const { browser, label } = await launch();
console.log(`browser: ${label} ${browser.version()}`);

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

await browser.close();
