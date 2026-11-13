// Capture : « Accepter les N à l'heure proposée… » (vague 3). Base locale après scripts/tablette/rush.mjs,
// AUDIT_BASE=http://localhost:3228. N'accepte rien.
import { chromium } from "@playwright/test";
import { BASE, connecter } from "../audit/lib.mjs";

const nav = await chromium.launch({ channel: "chrome" });
const [nom, valeur] = (await connecter(process.env.COMPTE ?? "equipe-bureau@laferme.test")).split("=");
const ctx = await nav.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Continuer sans son" }).click();
await page.locator(".tab-serie").getByRole("button").click();
await page.locator(".tab-serie").getByRole("button", { name: /^Accepter les \d+$/ }).waitFor();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/serie-confirmer-1180.png" });
await nav.close();
console.log("capture faite");
