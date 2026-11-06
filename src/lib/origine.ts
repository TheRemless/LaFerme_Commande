import "server-only";

// Adresse du site pour les liens envoyés (retour de paiement, courriels). En production, elle vient de
// la variable URL_SITE ; ailleurs, de la requête, mais seulement pour des hôtes attendus. Ainsi un
// en-tête Host trafiqué ne peut pas glisser un lien vers un autre site dans un courriel.
export function origineSure(requete: Request): string | null {
  if (process.env.CONTEXTE_DEPLOIEMENT === "production") {
    const u = process.env.URL_SITE;
    return u && /^https:\/\/[a-z0-9.-]+$/.test(u) ? u : null;
  }
  const o = new URL(requete.url).origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(o)) return o;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(o)) return o;
  return null;
}
