// Fonction planifiée Netlify (production seulement) : déclenche la surveillance du service chaque minute,
// même quand aucune imprimante ni tablette n'interroge le site.
export default async () => {
  const site = process.env.URL;
  if (!site) return;
  await fetch(`${site}/api/surveillance`, { method: "POST", signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
};

export const config = { schedule: "* * * * *" };
