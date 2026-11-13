// Capture : « Décaler les commandes en cours… » (aperçu) dans les réglages de la tablette (vague 3). Base locale
// après scripts/tablette/rush.mjs, AUDIT_BASE=http://localhost:3228. N'appuie pas sur « +N min ».
import { chromium } from "@playwright/test";
import { BASE, connecter } from "../audit/lib.mjs";

const nav = await chromium.launch({ channel: "chrome" });
const [nom, valeur] = (await connecter(process.env.COMPTE ?? "equipe-bureau@laferme.test")).split("=");
const ctx = await nav.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Continuer sans son" }).click();
await page.getByRole("button", { name: "Pause, délai, ruptures" }).click();
await page.getByRole("button", { name: "Décaler les commandes en cours…" }).click();
const bloc = page.locator(".tab-decaler");
await bloc.getByRole("button", { name: "+10 min" }).waitFor();
await bloc.scrollIntoViewIfNeeded();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/decaler-apercu-1180.png" });
await page.goto(`${BASE}/tablette/poste/pizza`);
await page.getByRole("button", { name: "Décaler les commandes pizza…" }).click();
await page.locator(".tab-decaler").getByRole("button", { name: "+10 min" }).waitFor();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/decaler-poste-pizza-1180.png" });
await nav.close();
console.log("captures faites");
