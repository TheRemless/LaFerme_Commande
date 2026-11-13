// Captures avant et après de la PR « robustesse au paiement » (vague 3, client-commande).
// Instance locale seulement : AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-robustesse.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });

const lignes = [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }];
const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };
const navigateur = await chromium.launch({ channel: "chrome" });

async function page(taille, choix = retrait) {
  const opts = taille === "mobile" ? { ...devices["iPhone 13"], viewport: { width: Number(process.env.LARGEUR ?? 375), height: 812 } } : { viewport: { width: 1440, height: 900 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/mentions-legales`);
  await p.evaluate(([c, l]) => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...c, enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: l }));
  }, [choix, lignes]);
  return p;
}

for (const taille of ["mobile", "bureau"]) {
  // Réseau coupé pendant le calcul du total.
  {
    const p = await page(taille);
    await p.route("**/api/panier", (r) => r.abort("internetdisconnected"));
    await p.goto(`${BASE}/commande`);
    await p.waitForTimeout(2500);
    await p.getByRole("button", { name: /^Payer/ }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${dossier}/${prefixe}-reseau-coupe-${taille}.png` });
    await p.context().close();
  }
  // Calcul lent (réseau 4G faible) : panier.
  {
    const p = await page(taille);
    await p.route("**/api/panier", async (r) => {
      await new Promise((ok) => setTimeout(ok, 6000));
      await r.continue().catch(() => undefined);
    });
    await p.goto(`${BASE}/panier`);
    await p.waitForTimeout(2000);
    await p.screenshot({ path: `${dossier}/${prefixe}-calcul-lent-${taille}.png` });
    await p.context().close();
  }
}

// Créneau rempli entre-temps, vu au paiement avant le clic (réponse du serveur reproduite).
{
  const p = await page("mobile", { ...retrait, quand: { type: "creneau", date: "2026-11-10", minutes: 1230 } });
  await p.route("**/api/panier", async (r) => {
    const vraie = await (await r.fetch()).json();
    await r.fulfill({ json: { ...vraie, valide: false, creneau_complet: true, message_quand: "Ce créneau est complet. Choisissez une autre heure ou appelez-nous au 022 792 16 89." } });
  });
  await p.goto(`${BASE}/commande`);
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /^Payer/ }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${dossier}/${prefixe}-creneau-complet-mobile.png` });
  await p.context().close();
}

await navigateur.close();
