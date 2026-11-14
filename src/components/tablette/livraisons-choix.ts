// Choix du livreur d'une commande (vague 3, P1 du contrôle de produit-gestion). Avant : un bouton par livreur et par
// commande (420 à l'écran sur le jeu de rush). Maintenant :
// - 4 livreurs actifs au plus : un bouton chacun, comme avant (pas de menu pour si peu) ;
// - au-delà : en boutons, les livreurs prévus au planning du service et ceux dont la page est ouverte sur le téléphone
//   depuis moins de 6 heures (il travaille, même s'il n'est pas au planning) ; les autres dans un menu « Donner à… ».
// Gérant ou responsable qui peut livrer (réponse de Jérémy du 14.11) : ne compte pas parmi les livreurs ; en bouton
// seulement s'il a sa page de livraisons ouverte ou est au planning, sinon dans « Donner à… ».
type Livreur = { id: string; nom: string; actif: boolean; vu_le?: string | null; role?: string };
const estChef = (l: Livreur) => !!l.role && l.role !== "livreur";
export const BOUTONS_MAX = 4;
const CONNECTE_MS = 6 * 3600_000;

export function choixLivreurs<T extends Livreur>(livreurs: T[], prevus: { ids: string[] } | null | undefined, maintenant = Date.now()): { boutons: T[]; menu: T[] } {
  const actifs = livreurs.filter((l) => l.actif);
  const ids = new Set(prevus?.ids ?? []);
  const travaille = (l: T) => ids.has(l.id) || (!!l.vu_le && maintenant - new Date(l.vu_le).getTime() < CONNECTE_MS);
  const enBouton = actifs.filter((l) => !estChef(l)).length <= BOUTONS_MAX ? (l: T) => !estChef(l) || travaille(l) : travaille;
  return { boutons: actifs.filter(enBouton), menu: actifs.filter((l) => !enBouton(l)) };
}

// Tournées affichées : livreurs prévus, ou qui ont encore une livraison (en cours ou annulée à rapporter). Sans
// planning pour ce service, tout le monde.
export function tourneesAffichees<T extends Livreur>(livreurs: T[], prevus: { ids: string[] } | null | undefined, avecLivraison: Set<string>): T[] {
  const ids = new Set(prevus?.ids ?? []);
  // Un gérant ou un responsable n'a une colonne que s'il livre (ou est au planning).
  livreurs = livreurs.filter((l) => !estChef(l) || ids.has(l.id) || avecLivraison.has(l.id));
  if (livreurs.filter((l) => l.actif).length <= BOUTONS_MAX || ids.size === 0) return livreurs;
  return livreurs.filter((l) => ids.has(l.id) || avecLivraison.has(l.id));
}
