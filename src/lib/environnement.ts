import "server-only";

// Où écrit le serveur, et ce qui en découle (docs/audits/securite.md, S1, S2 et S7).
// Les préversions écrivent dans le vrai projet Supabase : rien de ce qui sert aux essais (code de connexion
// à l'écran, paiement simulé, clé Stripe de test) n'y est permis. Seules exceptions : la base embarquée
// (poste local, tests) et un projet Supabase déclaré de test par BASE_DE_TEST=1.

// Le serveur a la clé d'écriture d'un projet Supabase.
export function baseReelle(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

// Base dont le contenu ne compte pas. Jamais vrai en production.
export function baseDeTest(): boolean {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") return false;
  return !baseReelle() || process.env.BASE_DE_TEST === "1";
}

// Le contexte est figé au build (next.config.ts). Un build fait sur le poste puis publié à la main sur
// Netlify se croirait « local » : IP lue dans un en-tête du client, cookies sans Secure, heure simulée.
// Les fonctions Netlify tournent sur AWS Lambda, qui pose AWS_LAMBDA_FUNCTION_NAME.
export function verifierContexte(): void {
  if (process.env.CONTEXTE_DEPLOIEMENT === "local" && process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error("Build du poste publié sur Netlify : refusé. Déployez par le build Netlify (docs/mise-en-ligne.md).");
  }
}
