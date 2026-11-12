import { createHmac } from "node:crypto";

// Fonction planifiée Netlify (production seulement) : déclenche la surveillance du service chaque minute,
// même quand aucune imprimante ni tablette n'interroge le site. La route exige un jeton tiré de la clé
// des empreintes (même calcul que empreinte("surveillance", "planifiee") dans src/lib/comptes/securite.ts).
export default async () => {
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

export const config = { schedule: "* * * * *" };
