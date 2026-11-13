import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";
import { validerCoupDeFeu, type ReglagesCoupDeFeu } from "@/lib/coup-de-feu-regles";

// Coup de feu (vague 3) : un geste qui durcit le service un soir chargé, puis tout revient seul.
// Base : supabase/migrations/20261130090000_coup_de_feu.sql. Doc : docs/coup-de-feu.md.

export type CleReglage = "retard_minutes" | "livraison_fermee" | "capacite_livraisons_par_creneau" | "capacite_retraits_par_creneau";
export type CoupDeFeu = {
  debut: string;
  jusqua: string;
  par: string | null;
  applique: Partial<Record<CleReglage, number | boolean>>;
  avant: Partial<Record<CleReglage, number | boolean>>;
};
export type EtatCoupDeFeu = {
  en_cours: CoupDeFeu | null;
  defaut: ReglagesCoupDeFeu;
  defaut_propose: boolean;
  actuel: Partial<Record<CleReglage, number | boolean>>;
};

export const etatCoupDeFeu = () => fonctionSql<EtatCoupDeFeu>("etat_coup_de_feu", {});

async function apres(): Promise<void> {
  // Heures annoncées, créneaux pleins et livraison : l'accueil et le panier lisent la config en cache.
  rafraichirCaches("config-service");
  await signalerTablette();
}

export async function lancerCoupDeFeu(p: Personnel, corps: unknown): Promise<{ ok: true; etat: EtatCoupDeFeu } | { ok: false; erreur: string }> {
  const v = validerCoupDeFeu(corps);
  if (!v.ok) return v;
  await fonctionSql("lancer_coup_de_feu", { p: v.valeur, p_personnel: p.id });
  await apres();
  return { ok: true, etat: await etatCoupDeFeu() };
}

export async function finirCoupDeFeu(p: Personnel): Promise<{ ok: boolean; etat: EtatCoupDeFeu }> {
  const r = await fonctionSql<unknown>("finir_coup_de_feu", { p_personnel: p.id });
  if (r) await apres();
  return { ok: r !== null, etat: await etatCoupDeFeu() };
}

// Surveillance : fin à l'heure dite. Renvoie vrai si un coup de feu vient de finir.
export async function finCoupDeFeuEchue(): Promise<boolean> {
  const r = await fonctionSql<unknown>("fin_coup_de_feu_echue", {});
  if (r) await apres();
  return r !== null;
}
