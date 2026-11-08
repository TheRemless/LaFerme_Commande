import type { Catalogue } from "@/lib/panier";

// Options écrites comme sur le ticket : CHOIX pour un choix obligatoire, + pour un supplément, SANS pour un retrait.
export function detailsTablette(cat: Catalogue | null, l: { choix: Record<string, string[]>; retraits: string[]; note: string }): string[] {
  const choix = Object.entries(l.choix ?? {}).flatMap(([g, noms]) => {
    const groupe = cat && Object.hasOwn(cat.groupes, g) ? cat.groupes[g] : undefined;
    const obligatoire = groupe ? groupe.choix_min >= 1 && groupe.choix_max === 1 : false;
    return noms.map((n) => (obligatoire ? `CHOIX ${n}` : `+ ${n}`));
  });
  return [...choix, ...(l.retraits ?? []).map((r) => `SANS ${r}`), ...(l.note ? [`« ${l.note} »`] : [])];
}
