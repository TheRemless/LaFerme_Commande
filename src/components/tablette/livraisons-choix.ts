// Choix du livreur d'une commande (vague 3, P1 du contrôle de produit-gestion). Avant : un bouton par livreur et par
// commande (420 à l'écran sur le jeu de rush). Maintenant :
// - 4 livreurs actifs au plus : un bouton chacun, comme avant (pas de menu pour si peu) ;
// - au-delà : en boutons, les livreurs prévus au planning du service et ceux dont la page est ouverte sur le téléphone
//   depuis moins de 6 heures (il travaille, même s'il n'est pas au planning) ; les autres dans un menu « Donner à… ».
type Livreur = { id: string; nom: string; actif: boolean; vu_le?: string | null };
export const BOUTONS_MAX = 4;
const CONNECTE_MS = 6 * 3600_000;

export function choixLivreurs<T extends Livreur>(livreurs: T[], prevus: { ids: string[] } | null | undefined, maintenant = Date.now()): { boutons: T[]; menu: T[] } {
  const actifs = livreurs.filter((l) => l.actif);
  if (actifs.length <= BOUTONS_MAX) return { boutons: actifs, menu: [] };
  const ids = new Set(prevus?.ids ?? []);
  const travaille = (l: T) => ids.has(l.id) || (!!l.vu_le && maintenant - new Date(l.vu_le).getTime() < CONNECTE_MS);
  return { boutons: actifs.filter(travaille), menu: actifs.filter((l) => !travaille(l)) };
}

// Tournées affichées : livreurs prévus, ou qui ont encore une livraison (en cours ou annulée à rapporter). Sans
// planning pour ce service, tout le monde.
export function tourneesAffichees<T extends Livreur>(livreurs: T[], prevus: { ids: string[] } | null | undefined, avecLivraison: Set<string>): T[] {
  const ids = new Set(prevus?.ids ?? []);
  if (livreurs.filter((l) => l.actif).length <= BOUTONS_MAX || ids.size === 0) return livreurs;
  return livreurs.filter((l) => ids.has(l.id) || avecLivraison.has(l.id));
}
