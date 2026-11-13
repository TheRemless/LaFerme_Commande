// Livreurs homonymes (vague 3, bo-operations ; P2 de produit-gestion). Deux livreurs au même nom se distinguent
// par le début de leur e-mail : « Nora (nora.b) » et « Nora (nora.k) ». Un nom unique reste tel quel.
// Pur : appliqué par la route /api/gestion/livreurs avant l'envoi au back-office (gérant).

export type NomLivreur = { id: string; nom: string; email: string };

const cle = (nom: string) => nom.trim().toLocaleLowerCase("fr");

export function nomsDistincts(livreurs: NomLivreur[]): Map<string, string> {
  const compte = new Map<string, number>();
  for (const l of livreurs) compte.set(cle(l.nom), (compte.get(cle(l.nom)) ?? 0) + 1);
  return new Map(livreurs.map((l) => [l.id, (compte.get(cle(l.nom)) ?? 0) > 1 ? `${l.nom} (${l.email.split("@")[0]})` : l.nom]));
}

// Remplace le nom de chaque livreur connu par son nom distinct, partout où un objet porte id (ou livreur_id) et nom.
export function appliquerNoms<T>(valeur: T, noms: Map<string, string>): T {
  if (Array.isArray(valeur)) return valeur.map((v) => appliquerNoms(v, noms)) as T;
  if (!valeur || typeof valeur !== "object") return valeur;
  const o = Object.fromEntries(Object.entries(valeur as Record<string, unknown>).map(([k, v]) => [k, appliquerNoms(v, noms)]));
  const id = typeof o.livreur_id === "string" ? o.livreur_id : typeof o.id === "string" ? o.id : null;
  if (id && typeof o.nom === "string" && noms.has(id)) o.nom = noms.get(id);
  return o as T;
}
