import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// Fermer le service du jour (vague 3, bo-operations ; droit fermer_service, rôle « responsable de service »).
// Pour le back-office (/api/gestion/fermer-jour) et la tablette (sa route, session tablette) : même fonction.
// Aujourd'hui seulement, la date vient de la base. Doc : docs/calendrier.md, « Fermer le service du jour ».

export type QuoiFermer = "midi" | "soir" | "journee";
export type ResultatFermeture = { ok: true; commandes: number[] } | { ok: false; erreur: string; code?: number };

const MESSAGES: [RegExp, string, number?][] = [
  [/droit_refuse/, "Réservé au gérant ou au responsable de service.", 403],
  [/service_invalide/, "Fermer : ce midi, ce soir ou toute la journée."],
  [/motif_invalide/, "Indiquez un motif (de 2 à 120 caractères). Les clients peuvent le lire : jamais un nom."],
  [/deja_ferme/, "C'est déjà fermé pour aujourd'hui."],
];

export async function fermerServiceDuJour(personnel: Personnel, quoi: unknown, motif: unknown): Promise<ResultatFermeture> {
  if (quoi !== "midi" && quoi !== "soir" && quoi !== "journee") return { ok: false, erreur: "Fermer : ce midi, ce soir ou toute la journée." };
  if (typeof motif !== "string") return { ok: false, erreur: "Indiquez un motif (de 2 à 120 caractères). Les clients peuvent le lire : jamais un nom." };
  try {
    await fonctionSql<number>("fermer_service_du_jour", { p_service: quoi, p_motif: motif, p_personnel: personnel.id });
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    const connu = MESSAGES.find(([m]) => m.test(texte));
    if (connu) return { ok: false, erreur: connu[1], code: connu[2] };
    throw e;
  }
  rafraichirCaches("config-service");
  await signalerTablette();
  // Commandes déjà prises pour ce moment : à traiter sur la tablette (même lecture que les autres fermetures).
  const jour = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
  const commandes = await fonctionSql<number[]>("commandes_dans_periode", { p_debut: jour, p_fin: jour, p_service: quoi === "journee" ? null : quoi }).catch(() => []);
  return { ok: true, commandes };
}
