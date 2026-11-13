import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { rembourserCommande } from "@/lib/commandes";
import { annulerImpression, imprimerCommande } from "@/lib/impression/service";
import { heureImpression, IMPRESSION_AVANCE_DEFAUT, momentTexte } from "@/lib/impression/avance";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { courrielAcceptation, courrielNouvelleHeure, courrielPrete, courrielRefus, courrielRefusRemboursementEnCours } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import { detailsTablette } from "@/lib/tablette-details";
import { auteur, type Personnel } from "@/lib/personnel/session";
import { hhmm } from "@/lib/heures";
import { depuisHeureGeneve } from "@/lib/service";
import { alerter } from "@/lib/surveillance";

// Ce que fait la tablette. Les passages de statut sont contrôlés en base (changer_statut) ; ici, les
// courriels au client, le remboursement d'un refus et le signal aux autres tablettes.

export type MoyenComptoir = "especes" | "carte";

export type CommandeTablette = {
  id: string;
  numero: number;
  cree_le: string;
  mode: "livraison" | "retrait";
  statut: string;
  statut_paiement: string;
  moyen_paiement: "en_ligne" | "comptoir";
  client_prenom: string;
  client_nom: string;
  client_telephone: string;
  adresse: { rue: string; numero: string; npa: string; localite: string } | null;
  details_livraison: { etage: string; sonnette: string; code: string; instructions: string } | null;
  zone_numero: number | null;
  quand_type: "asap" | "creneau";
  quand_date: string | null;
  quand_minutes: number | null;
  heure_confirmee: string | null;
  total_centimes: number;
  frais_centimes: number;
  motif: string | null;
  // Écart noté au paiement (pause, plat épuisé, heure dépassée) : audit « samedi soir », SS-08.
  avertissement: string | null;
  // Vague 3 : comment le client a payé au comptoir, et annulation faite par lui-même (absents avant la migration).
  moyen_comptoir?: MoyenComptoir | null;
  annulee_par_client_le?: string | null;
  // Paiement en ligne confirmé, ou création pour le comptoir : point de départ de « Attend depuis ».
  attend_depuis: string;
  lignes: { nom: string; qte: number; station: "pizza" | "cuisine"; choix: Record<string, string[]>; retraits: string[]; note: string; details: string[] }[];
  // Calculée ici : heure demandée par le client, ou au plus tôt pour « dès que possible ».
  heure_proposee: string;
  // Manques signalés (audit du gérant, G07) : montant remboursé ou déduit, et ce qui manquait.
  deduit_centimes?: number;
  manques?: string[];
};

const PAS_MS = 5 * 60_000;

export { detailsTablette } from "@/lib/tablette-details";

// « Dès que possible » : maintenant + préparation (retrait) ou délai moyen de la zone (livraison), arrondi à 5 min.
export async function fileTablette(maintenant = new Date()): Promise<CommandeTablette[]> {
  const [brut, config, cat, manques] = await Promise.all([
    fonctionSql<(Omit<CommandeTablette, "heure_proposee" | "lignes"> & { lignes: Omit<CommandeTablette["lignes"][number], "details">[] })[]>("file_tablette", {}),
    chargerConfigService(),
    chargerCatalogue().catch(() => null),
    // Absente tant que la base n'est pas migrée : la file passe quand même.
    fonctionSql<{ commande_id: string; deduit_centimes: number; manques: string[] }[]>("manques_en_cours", {}).catch(() => []),
  ]);
  return brut.map((brute) => {
    // Options écrites comme sur le ticket : CHOIX pour un choix obligatoire, + pour un supplément, SANS pour un retrait.
    const c = { ...brute, lignes: brute.lignes.map((l) => ({ ...l, details: detailsTablette(cat, l) })) };
    let proposee: Date | null = null;
    if (c.quand_type === "creneau" && c.quand_date && c.quand_minutes !== null) {
      proposee = depuisHeureGeneve(`${c.quand_date}T${hhmm(c.quand_minutes)}`);
    }
    if (!proposee || proposee.getTime() < maintenant.getTime()) {
      const zone = config.zones.find((z) => z.numero === c.zone_numero);
      const delai = c.mode === "livraison" && zone ? Math.round((zone.delai_min + zone.delai_max) / 2) : config.reglages.preparation_minutes;
      proposee = new Date(Math.ceil((maintenant.getTime() + delai * 60_000) / PAS_MS) * PAS_MS);
    }
    const m = manques.find((x) => x.commande_id === c.id);
    return { ...c, heure_proposee: proposee.toISOString(), ...(m ? { deduit_centimes: m.deduit_centimes, manques: m.manques } : {}) };
  });
}

// Heure envoyée par la tablette : une date valable, de cinq minutes en arrière à huit jours devant.
export function heureValide(v: unknown, maintenant = new Date()): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const d = new Date(v);
  const t = d.getTime();
  if (!Number.isFinite(t) || t < maintenant.getTime() - 5 * 60_000 || t > maintenant.getTime() + 8 * 86_400_000) return null;
  return d.toISOString();
}

async function prevenir(c: Commande, m: { sujet: string; texte: string; html: string }): Promise<void> {
  await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
    console.error(`Courriel « ${m.sujet} » non envoyé : ${e instanceof Error ? e.message : e}`),
  );
}

// Les autres tablettes se rafraîchissent tout de suite (Supabase Realtime, message vide). Sans Realtime,
// elles se remettent à jour à leur prochaine relecture (toutes les 5 secondes sans signal).
export async function signalerTablette(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SECRET_KEY;
  if (!url || !cle) return;
  await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: "tablette", event: "commande", payload: {} }] }),
    // Court : ce signal ne doit pas retarder le webhook ni le courriel qui suivent.
    signal: AbortSignal.timeout(1500),
  }).catch(() => undefined);
}

export type ResultatAction = { ok: boolean; message?: string };

// de : l'état que la tablette affichait. S'il a changé entre-temps (autre tablette), rien ne se fait (SS-06).
export type Action =
  | { action: "accepter"; heure: string; de?: string }
  | { action: "refuser"; motif: string; de?: string }
  | { action: "statut"; vers: "en_preparation" | "prete" | "partie" | "terminee"; de?: string }
  | { action: "heure"; heure: string }
  | { action: "encaisser"; moyen?: MoyenComptoir }
  | { action: "retiree_payee"; moyen?: MoyenComptoir }
  | { action: "reimprimer"; station?: "pizza" | "cuisine" }
  | { action: "rembourser" };

// Encaissement au comptoir, avec le moyen (espèces ou carte) pour la clôture du jour. Base pas encore migrée (pas de
// p_moyen) : on note l'encaissement sans le moyen plutôt que de perdre le geste.
async function encaisser(commandeId: string, par: string, moyen?: MoyenComptoir): Promise<boolean> {
  if (!moyen) return fonctionSql<boolean>("marquer_encaisse", { p_commande: commandeId, p_par: par });
  try {
    return await fonctionSql<boolean>("marquer_encaisse", { p_commande: commandeId, p_par: par, p_moyen: moyen });
  } catch (e) {
    // Seulement si la fonction à trois paramètres n'existe pas encore : une autre erreur (réseau après un
    // encaissement réussi) ne doit pas relancer l'appel, qui répondrait « déjà encaissée ».
    const m = e instanceof Error ? e.message : String(e);
    if (!/Could not find the function|does not exist|p_moyen/i.test(m)) throw e;
    console.error(`Moyen d'encaissement non noté, base pas encore migrée : ${m}`);
    return fonctionSql<boolean>("marquer_encaisse", { p_commande: commandeId, p_par: par });
  }
}

const changerStatut = (commande: string, vers: string, par: string, extra: { heure?: string; motif?: string; de?: string } = {}) =>
  fonctionSql<boolean>("changer_statut", { p_commande: commande, p_vers: vers, p_par: par, p_heure: extra.heure ?? null, p_motif: extra.motif ?? null, p_de: extra.de ?? null });

export async function agir(commandeId: string, a: Action, p: Personnel): Promise<ResultatAction> {
  const par = auteur(p);
  const avant = await commandeParId(commandeId);
  if (!avant) return { ok: false, message: "Commande introuvable." };
  let ok = false;
  let message: string | undefined;
  switch (a.action) {
    case "accepter":
      ok = await changerStatut(commandeId, "acceptee", par, { heure: a.heure, de: a.de });
      if (ok) {
        // Commande pour bientôt : tickets tout de suite. Pour plus tard (ce soir, un autre jour), la surveillance
        // les imprime à l'heure promise moins le délai de son mode, livraison ou retrait (SS-11). Un ticket qui ne part pas ne défait pas
        // l'acceptation : la surveillance réessaie, la tablette le montre et propose d'imprimer.
        const config = await chargerConfigService();
        const imprimerA = heureImpression(a.heure, (config.reglages.impression_avance ?? IMPRESSION_AVANCE_DEFAUT)[avant.mode]);
        const maintenant = new Date();
        if (imprimerA.getTime() <= maintenant.getTime()) {
          await imprimerCommande(commandeId).catch((e) => console.error(`Tickets non créés pour la commande ${avant.numero} : ${e instanceof Error ? e.message : e}`));
        } else {
          message = `Acceptée. Tickets prévus ${momentTexte(imprimerA, maintenant)}.`;
        }
        await prevenir(avant, courrielAcceptation(avant, a.heure));
      }
      break;
    case "refuser": {
      // Livraison partie (client absent, adresse introuvable) : fonction à part, le livreur le lit sur son téléphone.
      // Annuler une livraison partie rembourse tout : gérant seulement, revérifié en base (audit de sécurité 2, S2-01).
      if (avant.statut === "partie" && p.role !== "gerant") return { ok: false, message: "Seul le gérant peut annuler une livraison partie. Pour un client absent, passez par l'onglet Livraisons." };
      ok =
        avant.statut === "partie"
          ? (a.de === undefined || a.de === "partie") &&
            (await fonctionSql<boolean>("annuler_commande_partie", { p_commande: commandeId, p_par: par, p_motif: a.motif, p_personnel: p.id }))
          : await changerStatut(commandeId, "refusee", par, { motif: a.motif, de: a.de });
      if (!ok) break;
      // Commande déjà acceptée : la cuisine a peut-être son ticket. Les tickets en file partent, et chaque
      // poste qui a déjà le sien reçoit « ANNULÉE » (SS-03).
      if (avant.statut === "acceptee" || avant.statut === "en_preparation") {
        await annulerImpression(avant).catch((e) => console.error(`Annulation non imprimée pour la commande ${avant.numero} : ${e instanceof Error ? e.message : e}`));
      }
      if (avant.moyen_paiement === "en_ligne" && avant.statut_paiement === "paye") {
        // TWINT n'a pas de capture différée : le refus d'une commande payée se rembourse en entier.
        const r = await rembourserCommande(commandeId, a.motif).catch((e) => {
          console.error(`Remboursement impossible pour la commande ${avant.numero} : ${e instanceof Error ? e.message : e}`);
          return { rembourse: false };
        });
        if (r.rembourse) {
          message = "Commande refusée et remboursée.";
        } else {
          // Le client a payé : il apprend tout de suite le refus, et que le remboursement suit (SS-04).
          await prevenir(avant, courrielRefusRemboursementEnCours(avant, a.motif));
          await alerter(`Commande ${avant.numero} : remboursement à refaire`, [
            `La commande ${avant.numero} est refusée, mais le remboursement de ${(avant.total_centimes / 100).toFixed(2)} CHF n'est pas passé.`,
            "Sur la tablette, onglet « Terminées », touchez « Rembourser ». Si ça ne passe toujours pas, remboursez depuis Stripe.",
          ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
          message = "Commande refusée, mais le remboursement n'est pas passé. Réessayez.";
        }
      } else {
        await prevenir(avant, courrielRefus(avant, a.motif));
        message = "Commande refusée. Le client est prévenu.";
      }
      break;
    }
    case "rembourser": {
      if (avant.statut !== "refusee") return { ok: false, message: "Seule une commande refusée se rembourse ici." };
      const r = await rembourserCommande(commandeId, avant.motif ?? "").catch(() => ({ rembourse: false }));
      ok = r.rembourse;
      // Deux appuis en même temps : le second trouve la commande déjà remboursée (SS-16).
      if (!ok && (await commandeParId(commandeId))?.statut_paiement === "rembourse") ok = true;
      message = ok ? "Remboursement fait." : "Le remboursement n'est pas passé. Vérifiez dans Stripe ou appelez Jérémy.";
      break;
    }
    case "statut":
      ok = await changerStatut(commandeId, a.vers, par, { de: a.de });
      // Livraison : « en route » seulement au départ, pas quand elle attend le livreur au comptoir. Retrait : à « prête ».
      if (ok && a.vers === (avant.mode === "livraison" ? "partie" : "prete")) await prevenir(avant, courrielPrete(avant));
      break;
    case "heure":
      ok = await fonctionSql<boolean>("changer_heure", { p_commande: commandeId, p_heure: a.heure, p_par: par });
      if (ok) await prevenir(avant, courrielNouvelleHeure(avant, a.heure));
      break;
    case "encaisser":
      ok = await encaisser(commandeId, par, a.moyen);
      break;
    case "retiree_payee":
      // Retrait payé au comptoir : encaissée et retirée d'un seul geste (audit du gérant, G01).
      if (avant.statut !== "prete") break;
      ok = await changerStatut(commandeId, "terminee", par, { de: "prete" });
      if (ok && avant.statut_paiement === "a_encaisser_retrait") await encaisser(commandeId, par, a.moyen);
      break;
    case "reimprimer":
      if (!["acceptee", "en_preparation", "prete", "partie", "terminee"].includes(avant.statut)) return { ok: false, message: "Seule une commande acceptée s'imprime." };
      if (!avant.tickets_le && avant.statut !== "terminee") {
        // Commande à l'avance pas encore imprimée, ou tickets jamais créés : ce sont ses premiers tickets.
        // Terminée sans ticket (prête avant l'heure d'impression) : réimpression ordinaire, plus bas.
        ok = (await imprimerCommande(commandeId)) > 0;
        message = ok ? "Tickets envoyés à l'imprimante." : "Ces tickets sont déjà partis. La liste se met à jour.";
        break;
      }
      ok = (await imprimerCommande(commandeId, { reimpression: true, station: a.station })) > 0;
      message = ok ? "Ticket renvoyé à l'imprimante." : "Rien de plus à imprimer : le ticket attend encore l'imprimante.";
      break;
  }
  if (ok) await signalerTablette();
  return ok ? { ok, message } : { ok, message: message ?? "Cette commande a déjà changé. La liste se met à jour." };
}

// Pages publiques servies depuis le cache de Netlify et ce qu'elles lisent : on les vide avec les données.
// La carte et le panier lisent aussi la config (messages aux clients) : un message retiré les quitte aussitôt.
const PAGES_EN_CACHE = { "config-service": ["/", "/carte", "/panier"], catalogue: ["/carte", "/panier"] } as const;

export function rafraichirCaches(quoi: "config-service" | "catalogue"): void {
  try {
    revalidateTag(quoi);
    for (const chemin of PAGES_EN_CACHE[quoi]) revalidatePath(chemin);
  } catch (e) {
    // Hors requête Next (tests unitaires) : rien à vider. Ailleurs, une purge ratée laisse les pages
    // publiques en cache jusqu'à leur prochaine régénération (une minute) : on le note dans les journaux.
    if (!process.env.VITEST) console.error(`Cache ${quoi} non vidé : ${e instanceof Error ? e.message : e}`);
  }
}
