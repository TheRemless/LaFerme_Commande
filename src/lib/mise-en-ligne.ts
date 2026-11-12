// Contrôles du build de production (scripts/verifier-mise-en-ligne.ts). Fonctions pures, testées à part.
// Chaque problème bloque la mise en ligne (docs/PROMPT.md §5, docs/audits/securite.md S3 et S6).

type Env = Record<string, string | undefined>;

export type EtatBase = {
  platsBloquants: { motif: string }[];
  // Adresses en .test encore dans la table personnel.
  personnelTest: string[];
  // Imprimantes dont le nom dit « test » ou « préversion ».
  imprimantesTest: string[];
  // Commandes passées ailleurs que sur le domaine de production (préversions).
  commandesEtrangeres: number;
};

export function problemesConfiguration(env: Env): string[] {
  const p: string[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) p.push("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY manquante.");
  // Liens des courriels et contrôle d'origine des routes du compte : sans elle, tout est refusé.
  if (!/^https:\/\/[a-z0-9.-]+$/.test(env.URL_SITE ?? "")) p.push("URL_SITE manquante ou invalide (https://domaine, sans barre finale).");
  // Clé des empreintes propre à la production : sans elle, une session de préversion vaudrait ici.
  const secret = env.SECRET_COMPTES ?? "";
  if (secret.length < 32 || secret === env.SUPABASE_SECRET_KEY) {
    p.push("SECRET_COMPTES manquante, trop courte (32 caractères au moins) ou égale à la clé Supabase.");
  }
  if (env.BASE_DE_TEST) p.push("BASE_DE_TEST est posée : interdite en production.");
  if (env.SANS_LIMITE_COMPTOIR) p.push("SANS_LIMITE_COMPTOIR est posée : réservée aux tests de bout en bout.");
  return p;
}

export function problemesDonnees(e: EtatBase): string[] {
  const p: string[] = [];
  if (e.platsBloquants.length > 0) {
    const resume = new Map<string, number>();
    for (const l of e.platsBloquants) resume.set(l.motif, (resume.get(l.motif) ?? 0) + 1);
    for (const [motif, n] of resume) p.push(`${n} × ${motif}`);
  }
  if (e.personnelTest.length) p.push(`Membres d'équipe de test encore en base : ${e.personnelTest.join(", ")}.`);
  if (e.imprimantesTest.length) p.push(`Imprimantes de test encore en base : ${e.imprimantesTest.join(", ")}.`);
  if (e.commandesEtrangeres > 0) p.push(`${e.commandesEtrangeres} commandes passées hors du domaine de production (préversions) : à vider.`);
  return p;
}
