import "server-only";
import { courrielClientAbsent, courrielPrete } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import { auteur, exigerPersonnel, type Personnel } from "@/lib/personnel/session";
import { refus } from "@/lib/comptes/api";
import { signalerTablette } from "@/lib/tablette";
import { alerter } from "@/lib/surveillance";
import { prixChf } from "@/lib/prix";
import { deplacer, proposerOrdre, type ArretTournee } from "@/lib/tournee";

// Livreurs : la tablette attribue et range, le téléphone du livreur montre ses livraisons en cours et
// envoie trois gestes. Les contrôles (à qui est la livraison, quel statut) sont faits en base.

export type LivraisonLivreur = {
  commande_id: string;
  numero: number;
  statut: "acceptee" | "en_preparation" | "partie";
  heure: string | null;
  adresse: { rue: string; numero: string; npa: string; localite: string };
  details: { etage: string; sonnette: string; code: string; instructions: string } | null;
  zone: number | null;
  prenom: string;
  telephone: string;
  // Personne qui reçoit la commande, si ce n'est pas celle qui a commandé (vague 3, migration 20261212110000).
  destinataire?: { nom: string; telephone: string } | null;
  articles: number;
  pizzas: number;
  paye: boolean;
  total_centimes: number;
  // Commande prise au téléphone (vague 3, bo-commandes) : « telephone ». Absent avant la migration.
  canal?: "site" | "telephone";
  probleme: Probleme | null;
  probleme_detail: string | null;
};

export type RetireeLivreur = { commande_id: string; numero: number; raison: "annulee" | "reattribuee" | "retiree" | "client_absent"; partie: boolean };
export type Probleme = "client_absent" | "adresse_introuvable" | "autre";
export type Geste = "partie" | "livree" | "probleme" | "compris";

export const livraisonsDuLivreur = (p: Personnel) =>
  fonctionSql<{ livraisons: LivraisonLivreur[]; retirees: RetireeLivreur[] }>("livraisons_livreur", { p_livreur: p.id });

const MESSAGES: Record<string, string> = {
  pas_a_vous: "Cette livraison n'est plus à vous. La liste se met à jour.",
  annulee: "Commande annulée. Ne la livrez pas, rapportez le sac au restaurant.",
  statut: "Cette commande a déjà changé. La liste se met à jour.",
  motif: "Choisissez le problème.",
  detail: "Écrivez un mot pour expliquer le problème.",
  cle: "Geste refusé. Rechargez la page.",
  geste: "Geste inconnu.",
};

export async function gesteLivreur(
  p: Personnel,
  g: { cle: string; commande: string; geste: Geste; motif?: Probleme; detail?: string },
): Promise<{ ok: boolean; deja?: boolean; message?: string }> {
  const r = await fonctionSql<{ ok: boolean; prevenir?: boolean; deja?: boolean; raison?: string }>("geste_livreur", {
    p_cle: g.cle,
    p_livreur: p.id,
    p_commande: g.commande,
    p_geste: g.geste,
    p_motif: g.motif ?? null,
    p_detail: g.detail ?? null,
  });
  if (r.ok && r.prevenir) {
    // « Je pars » : le client reçoit le même e-mail « en route » que depuis la tablette.
    const c = await commandeParId(g.commande);
    if (c) {
      await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...courrielPrete(c) }).catch((e) =>
        console.error(`Courriel « en route » non envoyé : ${e instanceof Error ? e.message : e}`),
      );
    }
  }
  if (r.ok && !r.deja) await signalerTablette();
  return r.ok ? { ok: true, deja: r.deja } : { ok: false, message: MESSAGES[r.raison ?? ""] ?? MESSAGES.statut };
}

// ---------- Tablette ----------

// role : « livreur », ou « gerant » / « responsable » qui peut livrer (réponse de Jérémy du 14.11).
export type LivreurTablette = { id: string; nom: string; actif: boolean; vu_le: string | null; role?: string };
export type LivraisonTablette = {
  commande_id: string;
  numero: number;
  livreur_id: string;
  position: number;
  ordre_manuel: boolean;
  attribuee_le: string;
  commande_statut: string;
  probleme: Probleme | null;
  probleme_detail: string | null;
  probleme_le: string | null;
  partie_le: string | null;
};
// prevus (vague 3, P1 du contrôle de produit-gestion) : livreurs présents au planning du service en cours
// (bo-operations, planning_livreurs) ; ids vide = aucun planning pour ce service, la tablette propose alors tout le monde.
export type DonneesLivraisons = { livreurs: LivreurTablette[]; livraisons: LivraisonTablette[]; prevus?: { service: "midi" | "soir"; ids: string[] } | null };

export const livraisonsTablette = () => fonctionSql<DonneesLivraisons>("livreurs_tablette", {});

export type ActionLivraison =
  | { action: "attribuer"; commande: string; livreur: string }
  | { action: "retirer"; commande: string }
  | { action: "deplacer"; commande: string; livreur: string; sens: -1 | 1 }
  | { action: "proposer"; livreur: string }
  | { action: "regler_probleme"; commande: string }
  | { action: "client_absent"; commande: string };

const arrets = (livreur: string) => fonctionSql<(ArretTournee & { ordre_manuel: boolean })[]>("livraisons_a_ordonner", { p_livreur: livreur });
const ordonner = (livreur: string, commandes: string[], manuel: boolean, par: string) =>
  fonctionSql<boolean>("ordonner_livraisons", { p_livreur: livreur, p_commandes: commandes, p_manuel: manuel, p_par: par });

export async function agirLivraison(a: ActionLivraison, p: Personnel): Promise<{ ok: boolean; message?: string }> {
  const par = auteur(p);
  let ok = false;
  let message: string | undefined;
  switch (a.action) {
    case "attribuer": {
      const r = await fonctionSql<string>("attribuer_livraison", { p_commande: a.commande, p_livreur: a.livreur, p_par: par });
      ok = r === "ok" || r === "deja";
      if (r === "ok") {
        // Ordre proposé recalculé, sauf si quelqu'un l'a déjà rangé à la main.
        const liste = await arrets(a.livreur);
        if (!liste.some((x) => x.ordre_manuel)) await ordonner(a.livreur, proposerOrdre(liste), false, par);
      }
      if (r === "commande") message = "Cette commande ne peut plus être attribuée. La liste se met à jour.";
      if (r === "livreur") message = "Ce livreur ne fait plus partie de l'équipe.";
      break;
    }
    case "retirer":
      ok = await fonctionSql<boolean>("retirer_livraison", { p_commande: a.commande, p_par: par });
      break;
    case "deplacer": {
      const nouvel = deplacer((await arrets(a.livreur)).map((x) => x.commande_id), a.commande, a.sens);
      ok = nouvel ? await ordonner(a.livreur, nouvel, true, par) : false;
      break;
    }
    case "proposer": {
      const liste = await arrets(a.livreur);
      ok = liste.length > 0 && (await ordonner(a.livreur, proposerOrdre(liste), false, par));
      break;
    }
    case "regler_probleme":
      ok = await fonctionSql<boolean>("regler_probleme_livraison", { p_commande: a.commande, p_par: par });
      break;
    case "client_absent": {
      // Close sans remboursement : le client reçoit un e-mail factuel, le gérant une alerte et décide.
      const passage = await fonctionSql<string | null>("clore_client_absent", { p_commande: a.commande, p_par: par });
      ok = passage !== null;
      if (!ok) break;
      const c = await commandeParId(a.commande);
      if (c) {
        await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...courrielClientAbsent(c, passage!) }).catch((e) =>
          console.error(`Courriel « non remise » non envoyé : ${e instanceof Error ? e.message : e}`),
        );
        await alerter(`Commande ${c.numero} : client absent à la livraison`, [
          `La commande ${c.numero} (${prixChf(c.total_centimes)}) n'a pas pu être remise : client absent. Elle n'est pas remboursée.`,
          "Ouvrez-la dans le back-office, rubrique « Commandes », pour décider d'un remboursement total, partiel ou d'aucun.",
        ], "alerte", "client_absent").catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
      }
      message = "Livraison close sans remboursement. Le client est prévenu, le gérant décide dans le back-office.";
      break;
    }
  }
  if (ok) await signalerTablette();
  return ok ? { ok, message } : { ok, message: message ?? "Cette livraison a déjà changé. La liste se met à jour." };
}

// ---------- Le livreur choisit ses commandes et son ordre (réponses de Jérémy du 14.11.2026) ----------

// Routes du téléphone : un livreur, ou un gérant ou un responsable qui peut livrer (peut_livrer, relu à chaque appel).
export async function exigerLivreurOuChef(requete: Request, options: { lecture?: boolean } = {}) {
  const g = await exigerPersonnel(requete, { ...options, roles: ["livreur", "gerant", "responsable"] });
  if ("reponse" in g) return g;
  if (g.personnel.role !== "livreur" && !(await peutLivrer(g.personnel))) return { reponse: refus("Réservé aux livreurs.", 403) };
  return g;
}

export const peutLivrer = (p: Personnel) => fonctionSql<boolean>("peut_livrer", { p_personnel: p.id });

// Livraisons acceptées, tickets sortis, sans livreur : quartier et heure, sans l'adresse complète avant de prendre.
export type APrendre = { commande_id: string; numero: number; heure: string | null; npa: string; localite: string; zone: number | null; articles: number; pizzas: number };
export const livraisonsAPrendre = () => fonctionSql<APrendre[]>("livraisons_a_prendre", {});

// « Je prends » : atomique en base. Ordre proposé recalculé comme à la tablette, sauf ordre déjà fait à la main.
export async function prendreLivraison(p: Personnel, commande: string): Promise<{ ok: boolean; message?: string }> {
  const r = await fonctionSql<{ ok: boolean; raison?: string; par?: string }>("prendre_livraison", { p_commande: commande, p_livreur: p.id });
  if (!r.ok) {
    return {
      ok: false,
      message:
        r.raison === "prise" ? `Déjà prise par ${r.par}.` : r.raison === "livreur" ? "Votre compte ne peut pas livrer." : "Cette commande n'est plus à prendre. La liste se met à jour.",
    };
  }
  const liste = await arrets(p.id);
  if (!liste.some((x) => x.ordre_manuel)) await ordonner(p.id, proposerOrdre(liste), false, `livreur:${p.nom}`);
  await signalerTablette();
  return { ok: true };
}

// « Plus tôt » / « Plus tard » sur le téléphone : même fonction que la tablette, l'ordre fait à la main n'est plus
// recalculé. La base pose la marque de masquage si l'arrêt en cours change (position en direct).
export async function deplacerParLivreur(p: Personnel, commande: string, sens: -1 | 1): Promise<{ ok: boolean; message?: string }> {
  const nouvel = deplacer((await arrets(p.id)).map((x) => x.commande_id), commande, sens);
  const ok = nouvel ? await ordonner(p.id, nouvel, true, `livreur:${p.nom}`) : false;
  if (ok) await signalerTablette();
  return ok ? { ok } : { ok, message: "Cet ordre a déjà changé. La liste se met à jour." };
}

