// Capture du réglage « Tickets des commandes à l'avance » du back-office. AUDIT_BASE=http://localhost:3111 node scripts/audit/capture-reglage-avance.mjs
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
  const bloc = p.locator("section.ges-bloc", { hasText: "Tickets des commandes à l" });
  await bloc.waitFor();
  await bloc.screenshot({ path: `docs/rendus/service-a-lavance/apres-reglage-${nomVue}.png` });
  await ctx.close();
}
await b.close();
