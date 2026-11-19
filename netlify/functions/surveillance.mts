import { createHmac } from "node:crypto";
import { dansFenetreSurveillance } from "../../src/lib/fenetre-surveillance";

// Fonction planifiée Netlify (production seulement) : déclenche la surveillance du service toutes les 2 minutes,
// aux heures utiles seulement, même quand aucune imprimante ni tablette n'interroge le site. Hors des fenêtres de
// src/lib/fenetre-surveillance.ts, elle sort tout de suite sans appeler le site (Netlify sobre, docs/netlify-sobre.md).
// 2 minutes tiennent le refus automatique (C13 : refusée entre 15 et 17 minutes, jamais avant) et l'alerte
// « tablette muette » (3 minutes sans signe de vie : alerte entre 3 et 5 minutes).
// La route exige un jeton tiré de la clé des empreintes (même calcul que empreinte("surveillance", "planifiee") dans
// src/lib/comptes/securite.ts).
export default async () => {
  if (!dansFenetreSurveillance(new Date())) return;
  const site = process.env.URL;
  const source = process.env.SECRET_COMPTES ?? (process.env.CONTEXT === "production" ? undefined : process.env.SUPABASE_SECRET_KEY);
  if (!site || !source) return;
  const jeton = createHmac("sha256", `laferme-comptes:${source}`).update("surveillance:planifiee").digest("hex");
  await fetch(`${site}/api/surveillance`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);
};

// Heures UTC : identique à PLANIFICATION_SURVEILLANCE (src/lib/fenetre-surveillance.ts, vérifié par un test).
export const config = { schedule: "*/2 8-13,15-22 * * *" };
