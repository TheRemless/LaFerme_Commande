// Capture : « Modifier… » sur une commande en cours (vague 3), compte gérant de test. Base locale après
// scripts/tablette/rush.mjs, AUDIT_BASE=http://localhost:3228. N'enregistre rien.
import { chromium } from "@playwright/test";
import { BASE, connecter } from "../audit/lib.mjs";

const nav = await chromium.launch({ channel: "chrome" });
const [nom, valeur] = (await connecter(process.env.COMPTE ?? "gerant-bureau@laferme.test")).split("=");
const ctx = await nav.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Continuer sans son" }).click();
await page.getByRole("button", { name: /^En cours/ }).click();
const ligne = page.locator(".tab-ligne", { hasText: "Livraison" }).first();
await ligne.locator(".tab-ligne-corps").click();
const detail = page.locator(".tab-detail");
await detail.getByRole("button", { name: "Modifier…" }).click();
await detail.getByLabel("Téléphone").fill("079 444 55 66");
await detail.locator(".tab-modifier").scrollIntoViewIfNeeded();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/modifier-1180.png" });
await nav.close();
console.log("capture faite");
