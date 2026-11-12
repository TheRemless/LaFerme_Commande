import { chromium } from "@playwright/test";
import { BASE, connecter } from "./lib.mjs";
const cookie = await connecter("a11y-bureau@laferme.test");
const [nom, valeur] = cookie.split("=");
const b = await chromium.launch({ channel: "chrome" });
for (const [nomVue, vp] of [["bureau", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/gestion`);
  const onglet = p.getByRole("button", { name: /Livraison et horaires/ }).or(p.getByRole("tab", { name: /Livraison et horaires/ })).or(p.getByRole("link", { name: /Livraison et horaires/ }));
  await onglet.first().click();
  const bloc = p.locator("section.ges-bloc", { hasText: "Commandes par créneau" });
  await bloc.waitFor();
  await bloc.screenshot({ path: `docs/rendus/correctifs-service/apres-4-capacite-${nomVue}.png` });
  await ctx.close();
}
await b.close();
