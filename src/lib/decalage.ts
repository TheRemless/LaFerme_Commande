import "server-only";
import { courrielNouvelleHeure } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { signalerTablette } from "@/lib/tablette";

// Décaler les commandes en cours (vague 3, bo-operations, avec tablette) : +N minutes sur toutes les commandes
// acceptées ou en préparation des 90 prochaines minutes, ou sur celles d'un poste. Chaque client reçoit un
// e-mail « nouvelle heure », un seul par commande et par geste. Base : 20261130230000_decaler_commandes.sql.
// Doc : docs/decaler-commandes.md. Utilisé par le back-office et par la tablette.

export type Poste = "pizza" | "cuisine";
export type ResultatDecalage =
  | { ok: true; deja: boolean; minutes: number; commandes: number; prevenus: number }
  | { ok: false; erreur: string };

const MESSAGES: [RegExp, string][] = [
  [/Réservé à l'équipe/, "Réservé à l'équipe du restaurant."],
  [/de 5 à 90 minutes/, "Décalage : de 5 à 90 minutes."],
  [/Clé du geste/, "Geste illisible : rechargez la page."],
];

const poste = (v: unknown): Poste | null => (v === "pizza" || v === "cuisine" ? v : null);

// Ce que le geste toucherait maintenant, pour la confirmation.
export async function apercuDecalage(station: unknown): Promise<{ commandes: number; clients: number }> {
  return fonctionSql<{ commandes: number; clients: number }>("apercu_decalage", { p_station: poste(station) });
}

export async function decalerCommandes(p: { minutes: unknown; station?: unknown; cle: unknown }, personnel: Personnel): Promise<ResultatDecalage> {
  const minutes = Number(p.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 90) return { ok: false, erreur: "Décalage : de 5 à 90 minutes." };
  if (p.station !== undefined && p.station !== null && !poste(p.station)) return { ok: false, erreur: "Poste : pizza ou cuisine." };
  if (typeof p.cle !== "string" || p.cle.length < 8 || p.cle.length > 64) return { ok: false, erreur: "Geste illisible : rechargez la page." };
  let r: { deja: boolean; minutes: number; commandes: { id: string; avant: string; apres: string }[] };
  try {
    r = await fonctionSql("decaler_commandes", { p_minutes: minutes, p_station: poste(p.station), p_cle: p.cle, p_personnel: personnel.id });
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    const connu = MESSAGES.find(([m]) => m.test(texte));
    if (connu) return { ok: false, erreur: connu[1] };
    throw e;
  }
  // Même geste déjà fait (double appui, réseau qui renvoie) : aucun e-mail de plus.
  if (r.deja) return { ok: true, deja: true, minutes: r.minutes, commandes: r.commandes.length, prevenus: 0 };
  let prevenus = 0;
  for (const d of r.commandes) {
    const c = await commandeParId(d.id).catch(() => null);
    if (!c?.client_email) continue;
    // Un envoi refusé (quota) ou raté ne bloque pas les autres : il est noté dans l'historique de la commande.
    const ok = await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...courrielNouvelleHeure(c, new Date(d.apres).toISOString()) })
      .then(() => true)
      .catch((e) => {
        console.error(`Courriel « nouvelle heure » non envoyé (commande ${c.numero}) : ${e instanceof Error ? e.message : e}`);
        return false;
      });
    if (ok) prevenus += 1;
  }
  await signalerTablette();
  return { ok: true, deja: false, minutes: r.minutes, commandes: r.commandes.length, prevenus };
}
