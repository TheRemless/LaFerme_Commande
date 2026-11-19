import "server-only";
import type { Alerte } from "@/lib/accueil-gestion";
import { fonctionSql } from "@/lib/db/serveur";

// Parrainage à surveiller (vague 3, client-compte ; décision de Jérémy du 19.11.2026 : pas de SMS, des alertes au
// gérant). La base détecte les cas (20261217090000_alertes_parrainage.sql) ; la surveillance les envoie par e-mail ;
// l'accueil du back-office les montre tant que le gérant ne les a pas classés dans la rubrique Parrainages.

export const TYPES_SIGNAL: Record<string, string> = {
  trop_de_filleuls: "Beaucoup de filleuls crédités en 30 jours",
  meme_adresse: "Filleuls à la même adresse de livraison",
  meme_ip: "Filleuls connectés depuis la même adresse IP",
  meme_nom: "Filleuls au même nom",
  sans_suite: "Filleuls qui ne recommandent jamais",
  recu_plus_que_paye: "Plus reçu en parrainage que payé sur 30 jours",
  ip_du_parrain: "Filleul connecté depuis la même adresse IP que son parrain",
  chaine: "Filleul qui parraine à son tour dans les 90 jours",
};

export type CasParrainage = { id: number; type: string; compte_id: string; detail: Record<string, unknown> };

export const detecterAlertesParrainage = () => fonctionSql<CasParrainage[]>("detecter_alertes_parrainage", {});
export const noterAlerteParrainageEnvoyee = (id: number) => fonctionSql<null>("noter_alerte_parrainage_envoyee", { p_id: id });

// Un seul e-mail au restaurant par tour, quel que soit le nombre de cas : le type de signal seulement, jamais d'e-mail,
// de nom ni d'adresse de client.
export function courrielCasParrainage(cas: CasParrainage[]): { sujet: string; lignes: string[] } {
  const libelles = cas.map((c) => TYPES_SIGNAL[c.type] ?? "Parrainage à surveiller");
  return {
    sujet: cas.length === 1 ? `Parrainage à surveiller : ${libelles[0].toLowerCase()}` : `Parrainage à surveiller : ${cas.length} signaux`,
    lignes: [...libelles.map((l) => `${l}.`), "", "Le détail, les filleuls et le geste « Suspendre ce parrain » sont dans le back-office, rubrique Parrainages."],
  };
}

export function alerteParrainage(ouverts: number | null): Alerte | null {
  if (!ouverts) return null;
  return {
    cle: "parrainage",
    type: "parrainage",
    niveau: "attention",
    titre: ouverts > 1 ? `${ouverts} signaux de parrainage à examiner` : "Un signal de parrainage à examiner",
    detail: "Des filleuls se ressemblent, se suivent en chaîne, ou un compte reçoit plus qu'il ne paie.",
    geste: { href: "/gestion/parrainages", texte: "Voir les parrainages" },
  };
}

export async function chargerAlerteParrainage(): Promise<Alerte | null> {
  return alerteParrainage(await fonctionSql<number>("signaux_parrainage_ouverts", {}));
}
