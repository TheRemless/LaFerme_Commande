// Ruptures sur la tablette (vague 3, base de bo-carte #55) : textes et garde-fous, sans base ni réseau (testés seuls).

export type PlatRupture = { slug: string; nom: string; categorie: string; rupture: boolean; rupture_jusqu_au?: string | null; rupture_groupee?: string | null };
export type OptionRupture = { groupe: string; groupe_nom: string; nom: string; rupture: boolean; rupture_jusqu_au?: string | null; obligatoire?: boolean };

const JOUR = new Intl.DateTimeFormat("fr-CH", { timeZone: "UTC", day: "numeric", month: "short" });
const jourCourt = (iso: string) => JOUR.format(new Date(`${iso}T12:00:00Z`));

// Pourquoi ce plat est épuisé : la panne de tout le poste passe avant, puis une date plus lointaine qu'aujourd'hui.
export function texteRupture(p: Pick<PlatRupture, "rupture" | "rupture_jusqu_au" | "rupture_groupee">, aujourdHui: string): string | null {
  if (p.rupture_groupee?.startsWith("poste:")) return p.rupture_groupee === "poste:pizza" ? "Four en panne" : "Cuisine en panne";
  if (p.rupture_groupee) return "Toute la catégorie épuisée";
  if (!p.rupture) return null;
  if (p.rupture_jusqu_au && p.rupture_jusqu_au > aujourdHui) return `Épuisé jusqu'au ${jourCourt(p.rupture_jusqu_au)}`;
  return "Épuisé aujourd'hui";
}

// Remettre une rupture posée au back-office pour plusieurs jours demande une confirmation.
export const rupturePlanifiee = (p: Pick<PlatRupture, "rupture" | "rupture_jusqu_au">, aujourdHui: string) => p.rupture && !!p.rupture_jusqu_au && p.rupture_jusqu_au > aujourdHui;

// Épuiser la dernière option disponible d'un choix obligatoire rend tous les plats de ce groupe impossibles à commander.
export function derniereOptionObligatoire(options: OptionRupture[], o: OptionRupture): boolean {
  if (!o.obligatoire || o.rupture) return false;
  return options.filter((x) => x.groupe === o.groupe && x.nom !== o.nom).every((x) => x.rupture);
}

// Options regroupées par groupe (« Pâtes », « Suppléments pizza »), dans l'ordre reçu.
export function parGroupe(options: OptionRupture[]): { groupe: string; nom: string; obligatoire: boolean; options: OptionRupture[] }[] {
  const groupes = new Map<string, { groupe: string; nom: string; obligatoire: boolean; options: OptionRupture[] }>();
  for (const o of options) {
    const g = groupes.get(o.groupe) ?? { groupe: o.groupe, nom: o.groupe_nom, obligatoire: !!o.obligatoire, options: [] };
    g.options.push(o);
    groupes.set(o.groupe, g);
  }
  return [...groupes.values()];
}

// Commandes en cours qui contiennent un plat épuisé (contrat de bo-carte, commandes_touchees ; repli de la tablette).
// jour : jour de service (AAAA-MM-JJ), fourni par commandes_touchees de bo-carte ; le numéro repart à 1 chaque jour,
// la commande s'ouvre donc par son id.
export type Touchee = { id: string; numero: number; jour?: string | null; statut: string; mode: "livraison" | "retrait"; lignes: { nom: string; qte: number }[] };
type CommandeFile = { id: string; numero: number; statut: string; mode: "livraison" | "retrait"; quand_date: string | null; lignes: { nom: string; qte: number; station: string }[] };
const A_PREPARER = new Set(["nouvelle", "acceptee", "en_preparation"]);

export function commandesTouchees(commandes: CommandeFile[], { noms, station, jusqu }: { noms: Set<string>; station: string | null; jusqu: string }): Touchee[] {
  return commandes
    .filter((c) => A_PREPARER.has(c.statut) && (c.quand_date === null || c.quand_date <= jusqu))
    .map((c) => ({ c, lignes: c.lignes.filter((l) => noms.has(l.nom) || (station !== null && l.station === station)) }))
    .filter(({ lignes }) => lignes.length > 0)
    .map(({ c, lignes }) => ({ id: c.id, numero: c.numero, jour: c.quand_date, statut: c.statut, mode: c.mode, lignes: lignes.map((l) => ({ nom: l.nom, qte: l.qte })) }))
    .sort((a, b) => a.numero - b.numero);
}
