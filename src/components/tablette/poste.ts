// Vue par poste (vague 3, décision D12 à l'essai) : ce qu'un poste (pizza ou cuisine) a à sortir, sans base ni
// réseau (testé seul). Construite à partir de la file de la tablette et de postes_actifs() (commande_postes).

import type { CommandeTablette } from "@/lib/tablette";

export type Station = "pizza" | "cuisine";
export type PosteActif = { commande_id: string; station: Station; a_faire_le: string; lance_le: string | null; pret_le: string | null; pret_par: "poste" | "statut" | null };
type Ligne = CommandeTablette["lignes"][number];

export type CommandePoste = {
  id: string;
  numero: number;
  mode: "livraison" | "retrait";
  heure: string;
  client: string;
  a_faire_le: string;
  lance_le: string | null;
  lignes: Ligne[];
  // Allergie de toute la commande (client-commande), vide si rien de signalé.
  allergie: string;
};
export type SortiePoste = { id: string; numero: number; pret_le: string; par_le_poste: boolean; rouvrable: boolean; plats: number };
export type VuePoste = { en_cours: CommandePoste[]; sorties: SortiePoste[]; reste: { nom: string; qte: number }[] };

const EN_CUISINE = new Set(["acceptee", "en_preparation"]);

export function vuePoste(commandes: CommandeTablette[], postes: PosteActif[], station: Station): VuePoste {
  const parId = new Map(commandes.map((c) => [c.id, c]));
  const en_cours: CommandePoste[] = [];
  const sorties: SortiePoste[] = [];
  for (const p of postes) {
    if (p.station !== station) continue;
    const c = parId.get(p.commande_id);
    if (!c) continue;
    const lignes = c.lignes.filter((l) => l.station === station);
    if (p.pret_le === null) {
      if (!EN_CUISINE.has(c.statut)) continue;
      en_cours.push({
        id: c.id,
        numero: c.numero,
        mode: c.mode,
        heure: c.heure_confirmee ?? c.heure_proposee,
        client: `${c.client_prenom} ${c.client_nom.charAt(0)}.`,
        a_faire_le: p.a_faire_le,
        lance_le: p.lance_le,
        lignes,
        allergie: c.allergie?.trim() ?? "",
      });
    } else {
      sorties.push({
        id: c.id,
        numero: c.numero,
        pret_le: p.pret_le,
        par_le_poste: p.pret_par === "poste",
        rouvrable: EN_CUISINE.has(c.statut),
        plats: lignes.reduce((n, l) => n + l.qte, 0),
      });
    }
  }
  // Le plus ancien en tête : l'ordre des tickets sortis.
  en_cours.sort((a, b) => a.a_faire_le.localeCompare(b.a_faire_le) || a.numero - b.numero);
  sorties.sort((a, b) => b.pret_le.localeCompare(a.pret_le));
  const total = new Map<string, number>();
  for (const c of en_cours) for (const l of c.lignes) total.set(l.nom, (total.get(l.nom) ?? 0) + l.qte);
  const reste = [...total].map(([nom, qte]) => ({ nom, qte })).sort((a, b) => b.qte - a.qte || a.nom.localeCompare(b.nom, "fr"));
  return { en_cours, sorties: sorties.slice(0, 6), reste };
}

// « Pizza Margherita » → « Margherita » au poste pizza : le mot du poste n'apprend rien au pizzaiolo.
export function nomCourt(nom: string, station: Station): string {
  return station === "pizza" ? nom.replace(/^Pizza\s+/i, "") : nom;
}
