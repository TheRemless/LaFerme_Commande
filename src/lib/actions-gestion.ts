import "server-only";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { agir, heureValide, type ResultatAction } from "@/lib/tablette";

// Gestes du back-office sur une commande (vague 3, bo-commandes) : changer l'heure, annuler (remboursement
// complet d'une commande payée en ligne), réimprimer, renvoyer un e-mail. Les trois premiers passent par
// agir() de la tablette, sans rien y changer : mêmes contrôles en base, mêmes e-mails, mêmes tickets
// « ANNULÉE ». Chaque geste réussi est en plus noté au journal du back-office (objet commande_action).

export type ActionGestion =
  | { action: "heure"; heure: unknown }
  | { action: "annuler"; motif: unknown; de?: unknown }
  | { action: "reimprimer"; station?: unknown }
  | { action: "renvoyer_courriel"; courriel: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUTS = ["nouvelle", "acceptee", "en_preparation", "prete", "partie"];

async function noter(p: Personnel, commandeId: string, apres: Record<string, unknown>): Promise<void> {
  await fonctionSql("journaliser", { p_personnel: p.id, p_objet: "commande_action", p_cle: commandeId, p_avant: null, p_apres: apres }).catch((e) =>
    console.error(`Geste du back-office non journalisé : ${e instanceof Error ? e.message : e}`),
  );
}

export async function actionGestion(commandeId: string, a: ActionGestion, p: Personnel): Promise<ResultatAction> {
  switch (a.action) {
    case "heure": {
      const heure = heureValide(a.heure);
      if (!heure) return { ok: false, message: "Choisissez une heure à venir." };
      const r = await agir(commandeId, { action: "heure", heure }, p);
      if (r.ok) await noter(p, commandeId, { action: "heure", heure });
      return r.ok ? { ok: true, message: r.message ?? "Heure changée. Le client reçoit un e-mail." } : r;
    }
    case "annuler": {
      if (typeof a.motif !== "string") return { ok: false, message: "Écrivez un motif." };
      const m = a.motif.trim().replace(/\s+/g, " ");
      if (m.length < 3 || m.length > 200) return { ok: false, message: "Écrivez un motif (3 à 200 caractères). Le client le reçoit par e-mail." };
      const de = typeof a.de === "string" && STATUTS.includes(a.de) ? a.de : undefined;
      const motif = /[.!?]$/.test(m) ? m : `${m}.`;
      const r = await agir(commandeId, { action: "refuser", motif, de }, p);
      if (r.ok) await noter(p, commandeId, { action: "annuler", motif });
      return r;
    }
    case "reimprimer": {
      const station = a.station === "pizza" || a.station === "cuisine" ? a.station : undefined;
      const r = await agir(commandeId, { action: "reimprimer", station }, p);
      if (r.ok) await noter(p, commandeId, { action: "reimprimer", station: station ?? "tous" });
      return r;
    }
    case "renvoyer_courriel": {
      if (typeof a.courriel !== "string" || !UUID.test(a.courriel)) return { ok: false, message: "E-mail introuvable." };
      const [c, m] = await Promise.all([
        commandeParId(commandeId),
        fonctionSql<{ sujet: string; texte: string; html: string } | null>("courriel_a_renvoyer", { p_commande: commandeId, p_courriel: a.courriel }),
      ]);
      if (!c || !m) return { ok: false, message: "E-mail introuvable." };
      // Sujet marqué : le client voit que c'est un renvoi, et l'envoi n'est pas pris pour un doublon.
      try {
        await envoyerCourriel({ commandeId, destinataire: c.client_email, sujet: `${m.sujet} (nouvel envoi)`, texte: m.texte, html: m.html, type: "suivi" });
      } catch (e) {
        console.error(`Renvoi d'e-mail impossible pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
        return { ok: false, message: "L'e-mail n'est pas parti. Réessayez dans un instant." };
      }
      await noter(p, commandeId, { action: "renvoyer_courriel", courriel: a.courriel });
      return { ok: true, message: `E-mail renvoyé à ${c.client_email}.` };
    }
  }
}
