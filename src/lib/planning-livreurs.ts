import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { ajouterJours, instantGeneve } from "@/lib/service";
import { signalerTablette } from "@/lib/tablette";

// Planning et suivi des livreurs (vague 3, bo-operations). Base : migration 20261130120000_planning_livreurs.sql.
// Doc : docs/livreurs.md, partie « Planning et suivi ».

export type Service = "midi" | "soir";
export type Creneau = { jour: number; service: Service };
export type LivreurPlanifie = { id: string; nom: string; present: boolean; source: "semaine" | "ajout" | "absent"; motif: string | null };
export type JourPlanning = { jour: string; service: Service; presents: number; livreurs: LivreurPlanifie[] };
export type SemaineLivreur = { id: string; nom: string; creneaux: Creneau[] };
export type StatsLivreur = {
  livreur_id: string;
  nom: string;
  actif: boolean;
  livraisons: number;
  livrees: number;
  client_absent: number;
  problemes: number;
  minutes_moyennes: number | null;
  retard_moyen_minutes: number | null;
};
export type Resultat = { ok: true } | { ok: false; erreur: string; code?: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateValide = (v: unknown): string | null =>
  typeof v === "string" && DATE.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime()) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v) ? v : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Période lue par l'écran : 31 jours au plus pour le planning, 93 pour les statistiques.
export function periode(debut: unknown, fin: unknown, maxJours: number, maintenant = new Date()): { debut: string; fin: string } | null {
  const aujourdHui = instantGeneve(maintenant).date;
  const d = debut === undefined || debut === null ? aujourdHui : dateValide(debut);
  const f = fin === undefined || fin === null ? (d ? ajouterJours(d, 6) : null) : dateValide(fin);
  if (!d || !f || f < d || f > ajouterJours(d, maxJours - 1)) return null;
  return { debut: d, fin: f };
}

export async function lirePlanning(debut: string, fin: string) {
  const [semaines, planning] = await Promise.all([
    fonctionSql<SemaineLivreur[]>("semaines_livreurs", {}),
    fonctionSql<JourPlanning[]>("planning_livreurs", { p_debut: debut, p_fin: fin }),
  ]);
  return { semaines, planning };
}

export const lireStats = (debut: string, fin: string) => fonctionSql<StatsLivreur[]>("stats_livreurs", { p_debut: debut, p_fin: fin });

// Livreurs prévus pour un service donné (la tablette, l'heure réaliste v2).
export async function livreursDuService(jour: string, service: Service): Promise<LivreurPlanifie[]> {
  const p = await fonctionSql<JourPlanning[]>("planning_livreurs", { p_debut: jour, p_fin: jour });
  return p.find((x) => x.service === service)?.livreurs ?? [];
}

const erreurSql = (e: unknown): Resultat => {
  const m = e instanceof Error ? e.message : String(e);
  if (/retiré|Livreur inconnu/.test(m)) return { ok: false, erreur: "Ce livreur ne fait plus partie de l'équipe.", code: 404 };
  if (/aujourd'hui|60 jours/.test(m)) return { ok: false, erreur: "Choisissez un jour d'aujourd'hui à 60 jours." };
  throw e;
};

// Gérant : semaine type d'un livreur.
export async function reglerSemaine(p: Personnel, livreur: unknown, creneaux: unknown): Promise<Resultat> {
  if (typeof livreur !== "string" || !UUID.test(livreur)) return { ok: false, erreur: "Livreur inconnu.", code: 404 };
  if (
    !Array.isArray(creneaux) ||
    creneaux.length > 14 ||
    creneaux.some((c) => !c || typeof c !== "object" || !Number.isInteger(c.jour) || c.jour < 1 || c.jour > 7 || (c.service !== "midi" && c.service !== "soir"))
  ) {
    return { ok: false, erreur: "Semaine : jours de lundi à dimanche, midi ou soir." };
  }
  try {
    await fonctionSql("regler_semaine_livreur", { p_livreur: livreur, p_creneaux: creneaux.map((c) => ({ jour: c.jour, service: c.service })), p_personnel: p.id });
  } catch (e) {
    return erreurSql(e);
  }
  await signalerTablette();
  return { ok: true };
}

// Équipe (tablette ou back-office) : absent ou en plus ce jour-là, ou retour à la semaine type (present null).
export async function reglerJour(p: Personnel, livreur: unknown, jour: unknown, service: unknown, present: unknown, motif: unknown): Promise<Resultat> {
  if (typeof livreur !== "string" || !UUID.test(livreur)) return { ok: false, erreur: "Livreur inconnu.", code: 404 };
  const j = dateValide(jour);
  if (!j) return { ok: false, erreur: "Choisissez un jour d'aujourd'hui à 60 jours." };
  if (service !== "midi" && service !== "soir") return { ok: false, erreur: "Service : midi ou soir." };
  if (present !== null && typeof present !== "boolean") return { ok: false, erreur: "Présent, absent ou comme d'habitude." };
  const m = typeof motif === "string" ? motif.trim() : "";
  if (m && (m.length < 2 || m.length > 120)) return { ok: false, erreur: "Motif : de 2 à 120 caractères." };
  try {
    await fonctionSql("regler_jour_livreur", { p_livreur: livreur, p_jour: j, p_service: service, p_present: present, p_motif: m || null, p_personnel: p.id });
  } catch (e) {
    return erreurSql(e);
  }
  await signalerTablette();
  return { ok: true };
}
