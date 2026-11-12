import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { rembourserCommande } from "@/lib/commandes";
import { annulerImpression, imprimerCommande } from "@/lib/impression/service";
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
  | { action: "encaisser" }
  | { action: "retiree_payee" }
  | { action: "reimprimer"; station?: "pizza" | "cuisine" }
  | { action: "rembourser" };

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
        // L'acceptation, et elle seule, lance l'impression. Un ticket qui ne part pas ne défait pas l'acceptation :
        // la tablette le montre et propose de réimprimer.
        await imprimerCommande(commandeId).catch((e) => console.error(`Tickets non créés pour la commande ${avant.numero} : ${e instanceof Error ? e.message : e}`));
        await prevenir(avant, courrielAcceptation(avant, a.heure));
      }
      break;
    case "refuser": {
      ok = await changerStatut(commandeId, "refusee", par, { motif: a.motif, de: a.de });
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
      if (ok && (a.vers === "prete" || a.vers === "partie")) await prevenir(avant, courrielPrete(avant));
      break;
    case "heure":
      ok = await fonctionSql<boolean>("changer_heure", { p_commande: commandeId, p_heure: a.heure, p_par: par });
      if (ok) await prevenir(avant, courrielNouvelleHeure(avant, a.heure));
      break;
    case "encaisser":
      ok = await fonctionSql<boolean>("marquer_encaisse", { p_commande: commandeId, p_par: par });
      break;
    case "retiree_payee":
      // Retrait payé au comptoir : encaissée et retirée d'un seul geste (audit du gérant, G01).
      if (avant.statut !== "prete") break;
      ok = await changerStatut(commandeId, "terminee", par, { de: "prete" });
      if (ok && avant.statut_paiement === "a_encaisser_retrait") await fonctionSql<boolean>("marquer_encaisse", { p_commande: commandeId, p_par: par });
      break;
    case "reimprimer":
      if (!["acceptee", "en_preparation", "prete", "partie", "terminee"].includes(avant.statut)) return { ok: false, message: "Seule une commande acceptée s'imprime." };
      ok = (await imprimerCommande(commandeId, { reimpression: true, station: a.station })) > 0;
      message = ok ? "Ticket renvoyé à l'imprimante." : "Rien de plus à imprimer : le ticket attend encore l'imprimante.";
      break;
  }
  if (ok) await signalerTablette();
  return ok ? { ok, message } : { ok, message: message ?? "Cette commande a déjà changé. La liste se met à jour." };
}

// Pages publiques servies depuis le cache de Netlify et ce qu'elles lisent : on les vide avec les données.
const PAGES_EN_CACHE = { "config-service": ["/"], catalogue: ["/carte", "/panier"] } as const;

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
