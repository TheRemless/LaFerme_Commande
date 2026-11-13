// Capture : commande d'un autre jour avec sa date sous le numéro (jeu de rush de qualite, compte lea.rush). AUDIT_BASE=http://localhost:3228.
import { chromium } from "@playwright/test";
import { BASE, connecter } from "../audit/lib.mjs";
const nav = await chromium.launch({ channel: "chrome" });
const [nom, valeur] = (await connecter("lea.rush@exemple.test")).split("=");
const ctx = await nav.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Continuer sans son" }).click();
await page.getByRole("button", { name: /^Terminées/ }).click();
const ligne = page.locator(".tab-ligne.tab-autre-jour").first();
await ligne.waitFor({ timeout: 30000 });
console.log("autres jours :", await page.locator(".tab-ligne.tab-autre-jour").count(), await ligne.locator(".tab-ligne-num").innerText());
await ligne.locator(".tab-ligne-corps").click();
await page.locator(".tab-detail .tab-num-jour").waitFor();
await ligne.scrollIntoViewIfNeeded();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/numero-autre-jour-paysage-1024.png" });
await nav.close();
