import { createHash } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

// Adresse du serveur de test (playwright.config.ts) : le port se règle avec PORT_E2E.
export const SITE = `http://localhost:${process.env.PORT_E2E ?? 3200}`;

// Les demandes de code du personnel sont limitées à 20 par heure et par adresse IP (envoi_ip). Toute la
// suite tourne depuis le même poste : sans adresse propre, les fichiers qui se connectent se partagent ces
// 20 codes et le suivant reçoit « Trop d'essais » selon l'ordre de passage. Chaque compte de test a donc
// son adresse simulée, tirée de son e-mail (déjà propre à chaque fichier et à chaque projet).
// x-forwarded-for n'est cru que sur le poste local (ipDe, src/lib/comptes/securite.ts), jamais sur Netlify.
export function ipDuCompte(email: string): string {
  const h = createHash("sha256").update(email).digest();
  return `10.${200 + (h[0] % 50)}.${h[1]}.${1 + (h[2] % 250)}`;
}

// À appeler avant de demander un code avec cette page.
export async function adresseDuCompte(page: Page, email: string): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ipDuCompte(email) });
}

// Connexion d'un compte de l'équipe par l'API (sans page). Un seul code par e-mail toutes les 30 secondes :
// au réessai d'un test, la demande tombe souvent dans ce délai. On attend alors le temps annoncé au lieu
// d'échouer. Adresse simulée propre au compte, comme adresseDuCompte.
export async function connecterPersonnelApi(request: APIRequestContext, email: string): Promise<void> {
  const headers = { "x-forwarded-for": ipDuCompte(email) };
  for (let essai = 0; essai < 3; essai++) {
    const r = await request.post("/api/personnel/code", { headers, data: { email } });
    const corps = (await r.json()) as { codePreversion?: string; erreur?: string };
    if (corps.codePreversion) {
      const c = await request.post("/api/personnel/connexion", { headers, data: { email, code: corps.codePreversion } });
      if (!c.ok()) throw new Error(`Connexion de ${email} refusée (${c.status()})`);
      return;
    }
    const secondes = Number(corps.erreur?.match(/dans (\d+) seconde/)?.[1]);
    if (r.status() !== 429 || !secondes) throw new Error(`Pas de code pour ${email} (${r.status()}) : ${corps.erreur ?? ""}`);
    await new Promise((ok) => setTimeout(ok, (secondes + 1) * 1000));
  }
  throw new Error(`Pas de code pour ${email} après trois essais`);
}
