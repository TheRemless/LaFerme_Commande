import "server-only";
import { revalidateTag } from "next/cache";
import { rembourserCommande } from "@/lib/commandes";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { courrielAcceptation, courrielNouvelleHeure, courrielPrete, courrielRefus } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import type { Catalogue } from "@/lib/panier";
import { auteur, type Personnel } from "@/lib/personnel/session";
import { depuisHeureGeneve, heureTexte } from "@/lib/service";

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
  lignes: { nom: string; qte: number; station: "pizza" | "cuisine"; choix: Record<string, string[]>; retraits: string[]; note: string; details: string[] }[];
  // Calculée ici : heure demandée par le client, ou au plus tôt pour « dès que possible ».
  heure_proposee: string;
};

const PAS_MS = 5 * 60_000;

export function detailsTablette(cat: Catalogue | null, l: { choix: Record<string, string[]>; retraits: string[]; note: string }): string[] {
  const choix = Object.entries(l.choix ?? {}).flatMap(([g, noms]) => {
    const groupe = cat && Object.hasOwn(cat.groupes, g) ? cat.groupes[g] : undefined;
    const obligatoire = groupe ? groupe.choix_min >= 1 && groupe.choix_max === 1 : false;
    return noms.map((n) => (obligatoire ? `CHOIX ${n}` : `+ ${n}`));
  });
  return [...choix, ...(l.retraits ?? []).map((r) => `SANS ${r}`), ...(l.note ? [`« ${l.note} »`] : [])];
}

// « Dès que possible » : maintenant + préparation (retrait) ou délai moyen de la zone (livraison), arrondi à 5 min.
export async function fileTablette(maintenant = new Date()): Promise<CommandeTablette[]> {
  const [brut, config, cat] = await Promise.all([
    fonctionSql<(Omit<CommandeTablette, "heure_proposee" | "lignes"> & { lignes: Omit<CommandeTablette["lignes"][number], "details">[] })[]>("file_tablette", {}),
    chargerConfigService(),
    chargerCatalogue().catch(() => null),
  ]);
  return brut.map((brute) => {
    // Options écrites comme sur le ticket : CHOIX pour un choix obligatoire, + pour un supplément, SANS pour un retrait.
    const c = { ...brute, lignes: brute.lignes.map((l) => ({ ...l, details: detailsTablette(cat, l) })) };
    let proposee: Date | null = null;
    if (c.quand_type === "creneau" && c.quand_date && c.quand_minutes !== null) {
      proposee = depuisHeureGeneve(`${c.quand_date}T${heureTexte(c.quand_minutes).replace("h", ":")}`);
    }
    if (!proposee || proposee.getTime() < maintenant.getTime()) {
      const zone = config.zones.find((z) => z.numero === c.zone_numero);
      const delai = c.mode === "livraison" && zone ? Math.round((zone.delai_min + zone.delai_max) / 2) : config.reglages.preparation_minutes;
      proposee = new Date(Math.ceil((maintenant.getTime() + delai * 60_000) / PAS_MS) * PAS_MS);
    }
    return { ...c, heure_proposee: proposee.toISOString() };
  });
}

// Heure envoyée par la tablette : une date valable, d'une heure en arrière à huit jours devant.
export function heureValide(v: unknown, maintenant = new Date()): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const d = new Date(v);
  const t = d.getTime();
  if (!Number.isFinite(t) || t < maintenant.getTime() - 3_600_000 || t > maintenant.getTime() + 8 * 86_400_000) return null;
  return d.toISOString();
}

async function prevenir(c: Commande, m: { sujet: string; texte: string; html: string }): Promise<void> {
  await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
    console.error(`Courriel « ${m.sujet} » non envoyé : ${e instanceof Error ? e.message : e}`),
  );
}

// Les autres tablettes se rafraîchissent tout de suite (Supabase Realtime, message vide). Sans Realtime,
// elles se remettent à jour à leur prochaine vérification, toutes les 5 secondes.
export async function signalerTablette(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SECRET_KEY;
  if (!url || !cle) return;
  await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: "tablette", event: "commande", payload: {} }] }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}

export type ResultatAction = { ok: boolean; message?: string };

export type Action =
  | { action: "accepter"; heure: string }
  | { action: "refuser"; motif: string }
  | { action: "statut"; vers: "en_preparation" | "prete" | "partie" | "terminee" }
  | { action: "heure"; heure: string }
  | { action: "encaisser" }
  | { action: "rembourser" };

export async function agir(commandeId: string, a: Action, p: Personnel): Promise<ResultatAction> {
  const par = auteur(p);
  const avant = await commandeParId(commandeId);
  if (!avant) return { ok: false, message: "Commande introuvable." };
  let ok = false;
  let message: string | undefined;
  switch (a.action) {
    case "accepter":
      ok = await fonctionSql<boolean>("changer_statut", { p_commande: commandeId, p_vers: "acceptee", p_par: par, p_heure: a.heure, p_motif: null });
      if (ok) await prevenir(avant, courrielAcceptation(avant, a.heure));
      break;
    case "refuser": {
      ok = await fonctionSql<boolean>("changer_statut", { p_commande: commandeId, p_vers: "refusee", p_par: par, p_heure: null, p_motif: a.motif });
      if (!ok) break;
      if (avant.moyen_paiement === "en_ligne" && avant.statut_paiement === "paye") {
        // TWINT n'a pas de capture différée : le refus d'une commande payée se rembourse en entier.
        const r = await rembourserCommande(commandeId, a.motif).catch((e) => {
          console.error(`Remboursement impossible pour la commande ${avant.numero} : ${e instanceof Error ? e.message : e}`);
          return { rembourse: false };
        });
        message = r.rembourse ? "Commande refusée et remboursée." : "Commande refusée, mais le remboursement n'est pas passé. Réessayez.";
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
      message = ok ? "Remboursement fait." : "Le remboursement n'est pas passé. Vérifiez dans Stripe ou appelez Jérémy.";
      break;
    }
    case "statut":
      ok = await fonctionSql<boolean>("changer_statut", { p_commande: commandeId, p_vers: a.vers, p_par: par, p_heure: null, p_motif: null });
      if (ok && (a.vers === "prete" || a.vers === "partie")) await prevenir(avant, courrielPrete(avant));
      break;
    case "heure":
      ok = await fonctionSql<boolean>("changer_heure", { p_commande: commandeId, p_heure: a.heure, p_par: par });
      if (ok) await prevenir(avant, courrielNouvelleHeure(avant, a.heure));
      break;
    case "encaisser":
      ok = await fonctionSql<boolean>("marquer_encaisse", { p_commande: commandeId, p_par: par });
      break;
  }
  if (ok) await signalerTablette();
  return ok ? { ok, message } : { ok, message: message ?? "Cette commande a déjà changé. La liste se met à jour." };
}

export function rafraichirCaches(quoi: "config-service" | "catalogue"): void {
  try {
    revalidateTag(quoi);
  } catch {
    // Hors requête Next (tests) : rien à vider.
  }
}
