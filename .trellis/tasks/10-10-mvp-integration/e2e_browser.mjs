// Browser checks for the end-to-end walk against the composed stack (run by e2e_walk.py).
//
//   node e2e_browser.mjs <base> setup-redirect
//   node e2e_browser.mjs <base> onboarding-redirect <user> <password>
//   node e2e_browser.mjs <base> dashboard <user> <password> <screenshot.png>
//
// Uses the frontend's Playwright with Playwright Chromium if installed, else Microsoft Edge.
// Prints one JSON line with the observations.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(new URL("../../../frontend/package.json", import.meta.url)));
const { chromium } = require("playwright");

const [base, mode, user, password, out] = process.argv.slice(2);

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: "msedge" });
  }
}

const browser = await launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  colorScheme: "light",
});
const errors = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const result = { mode, browser: browser.version() };

try {
  if (mode !== "setup-redirect") {
    const login = await context.request.post(`${base}/api/v1/auth/login`, {
      data: { username: user, password },
    });
    result.login = login.status();
  }
  if (mode === "setup-redirect") {
    await page.goto(`${base}/dashboard`);
    await page.waitForURL(/\/setup$/, { timeout: 15000 });
    result.url = page.url();
    result.title = await page.title();
  } else if (mode === "onboarding-redirect") {
    await page.goto(`${base}/dashboard`);
    await page.waitForURL(/\/onboarding$/, { timeout: 15000 });
    result.url = page.url();
  } else if (mode === "dashboard") {
    await page.goto(`${base}/dashboard`);
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000); // chart animations
    result.url = page.url();
    result.heading = await page.getByRole("heading", { level: 1 }).first().innerText();
    result.text = (await page.locator("body").innerText()).slice(0, 2000);
    await page.screenshot({ path: out, fullPage: true });
    result.screenshot = out;
    // A deep link reloads through nginx's SPA fallback.
    const response = await page.goto(`${base}/transactions`);
    result.deepLinkStatus = response.status();
    await page.waitForLoadState("networkidle");
    result.transactionsText = (await page.locator("body").innerText()).slice(0, 3000);
  }
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error);
  result.url = page.url();
}
result.errors = errors;
console.log(JSON.stringify(result));
await browser.close();
