// Accueil du back-office : la journée en un coup d'œil (vague 3, bo-socle). Lundi 9h ou vendredi 20h, le
// gérant voit en dix secondes ce qui demande un geste. Ce module ne fait que rassembler ce qui existe :
// file de la tablette, état du service, impression, quota d'e-mails, ventes (pilotage_ventes, bo-pilotage),
// planning des livreurs (bo-operations). Une source en panne ne vide pas l'accueil : sa partie vaut null et
// l'écran dit « indisponible ». Les alertes sont aussi lues hors de l'accueil (compteur dans le titre de
// l'onglet, badge du menu, notifications : src/components/gestion/alertes.tsx).

import type { Alerte, CommandeAlerte } from "@/lib/alertes-types";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { etatQuotaCourriels, type EtatQuota } from "@/lib/courriel/quota";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { heureDe } from "@/lib/heures";
import { etatImpression, type EtatImpression } from "@/lib/impression/service";
import { jourDeService, serviceDe, type Service, type TableauVentes } from "@/lib/pilotage";
import { livreursDuService } from "@/lib/planning-livreurs";
import { ajouterJours, enMinutes, etatService, instantGeneve, servicesDu, serviceEnCours, zoneFermeeJusqua, type ConfigService, type EtatService } from "@/lib/service";
import { fileTablette, type CommandeTablette } from "@/lib/tablette";

const ACTIVES = ["acceptee", "en_preparation", "prete", "partie"];
const EN_CUISINE_OU_EN_ROUTE = ["acceptee", "en_preparation", "partie"];
// Même seuil que la surveillance (src/lib/surveillance.ts) : 3 minutes sans signe de vie.
const TABLETTE_MUETTE_S = 180;

export type ResumeCommandes = {
  a_accepter: number;
  /** Depuis quand attend la plus ancienne à accepter (ISO), null s'il n'y en a pas. */
  plus_ancienne: string | null;
  /** À accepter depuis plus que le réglage alerte_acceptation_minutes. */
  a_accepter_en_retard: { numero: number; depuis: string }[];
  en_cours: number;
  pretes: number;
  /** Acceptées, en préparation ou parties, dont l'heure promise est passée. */
  en_retard: { numero: number; heure: string }[];
  a_l_avance: number;
};

export type EtatRestaurant = {
  livraison: EtatService;
  retrait: EtatService;
  en_service: boolean;
  retard_minutes: number;
  zones_fermees: { numero: number; jusqua: string | null }[];
  ruptures: { nom: string; jusqu_au: string | null }[];
};

export type { Alerte, CommandeAlerte } from "@/lib/alertes-types";

type Suivi = { numero: number; cree_le: string; commande_id?: string; jour?: string };

export type DonneesAccueil = {
  maintenant: string;
  jour: string;
  service: Service;
  commandes: ResumeCommandes | null;
  restaurant: EtatRestaurant | null;
  ventes: TableauVentes | null;
  /** Commandes au comptoir des sept jours d'avant pas notées encaissées (jours fermés compris). */
  hier_a_encaisser: number | null;
  /** Ces commandes-là, avec leur jour (100 au plus). Facultatif pour les anciens appels. */
  hier_a_encaisser_commandes?: CommandeAlerte[] | null;
  impression: Pick<EtatImpression, "imprimantes"> & { echecs: number } | null;
  tablette_muette: boolean | null;
  quota: EtatQuota | null;
  alerte_acceptation_minutes: number;
  /** Livreurs présents au planning pour le service en cours ; null quand la livraison n'est pas ouverte à ce
   *  service (fermée, service fini, aucune zone) ou que le planning est illisible. */
  livreurs_prevus?: number | null;
  /** Remboursements à suivre, tous jours confondus (remboursements_a_suivre de bo-pilotage) : en échec, ou pas
   *  confirmés par Stripe depuis plus de 24 heures. null tant que la fonction manque (base pas encore migrée) :
   *  l'accueil retombe alors sur les chiffres du service en cours. Champ facultatif pour les anciens appels. */
  remboursements?: { echecs: Suivi[]; bloques: Suivi[] } | null;
};

type RemboursementASuivre = { numero: number; statut: string; cree_le: string; commande_id: string; jour: string };
type LigneListe = { id: string; numero: number; jour_service: string; statut: string };

const sur = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export function resumerCommandes(file: CommandeTablette[], maintenant: Date, alerteMinutes: number): ResumeCommandes {
  const aujourdhui = jourDeService(maintenant);
  const pourAujourdhui = (c: CommandeTablette) => c.quand_type === "asap" || !c.quand_date || c.quand_date <= aujourdhui;
  const nouvelles = file.filter((c) => c.statut === "nouvelle" && pourAujourdhui(c)).sort((a, b) => a.attend_depuis.localeCompare(b.attend_depuis));
  const seuil = maintenant.getTime() - alerteMinutes * 60_000;
  return {
    a_accepter: nouvelles.length,
    plus_ancienne: nouvelles[0]?.attend_depuis ?? null,
    a_accepter_en_retard: nouvelles.filter((c) => new Date(c.attend_depuis).getTime() < seuil).map((c) => ({ numero: c.numero, depuis: c.attend_depuis })),
    en_cours: file.filter((c) => ACTIVES.includes(c.statut)).length,
    pretes: file.filter((c) => c.statut === "prete").length,
    en_retard: file
      .filter((c) => EN_CUISINE_OU_EN_ROUTE.includes(c.statut))
      .map((c) => ({ numero: c.numero, heure: c.heure_confirmee ?? c.heure_proposee }))
      .filter((c) => new Date(c.heure).getTime() < maintenant.getTime())
      .sort((a, b) => a.heure.localeCompare(b.heure)),
    a_l_avance: file.filter((c) => c.statut === "nouvelle" && !pourAujourdhui(c)).length,
  };
}

export function etatRestaurant(config: ConfigService, maintenant: Date, ruptures: EtatRestaurant["ruptures"], reel = maintenant.getTime()): EtatRestaurant {
  return {
    livraison: etatService(config, maintenant, "livraison"),
    retrait: etatService(config, maintenant, "retrait"),
    en_service: serviceEnCours(config, maintenant),
    retard_minutes: Number(config.reglages.retard_minutes ?? 0),
    zones_fermees: config.zones
      .filter((z) => z.active && zoneFermeeJusqua(z, reel))
      .map((z) => ({ numero: z.numero, jusqua: zoneFermeeJusqua(z, reel) })),
    ruptures,
  };
}

const NB = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Une commande par fiche (deux remboursements de la même commande n'en font qu'une), dans l'ordre reçu. */
function commandesDe(suivis: Suivi[]): CommandeAlerte[] | undefined {
  const vues = new Map<string, CommandeAlerte>();
  for (const s of suivis) if (s.commande_id && s.jour && !vues.has(s.commande_id)) vues.set(s.commande_id, { id: s.commande_id, numero: s.numero, jour: s.jour });
  return vues.size ? [...vues.values()] : undefined;
}

/** Adresse de la liste des commandes filtrée. Seulement des filtres, jamais une donnée de client. */
export function listeFiltree(filtres: Record<string, string>): string {
  return `/gestion/commandes?${new URLSearchParams(filtres).toString()}`;
}

/** Période qui couvre toutes les commandes citées (du plus ancien jour à aujourd'hui). */
function periodeDe(commandes: CommandeAlerte[] | undefined, jour: string): Record<string, string> {
  const jours = (commandes ?? []).map((c) => c.jour).sort();
  return { du: jours[0] ?? jour, au: jour };
}

/** Ce qui demande un geste, du plus urgent au moins urgent. Pur : testé dans tests/unit/accueil-gestion.test.ts. */
export function alertesDe(d: DonneesAccueil): Alerte[] {
  const a: Alerte[] = [];
  const c = d.commandes;
  if (c && c.a_accepter_en_retard.length) {
    const n = c.a_accepter_en_retard.map((x) => x.numero).join(", ");
    a.push({
      cle: "a-accepter",
      type: "acceptation",
      niveau: "bloquant",
      titre: c.a_accepter_en_retard.length > 1 ? `Commandes ${n} pas encore acceptées` : `Commande ${n} pas encore acceptée`,
      detail: `Plus de ${d.alerte_acceptation_minutes} min d'attente.`,
      depuis: c.a_accepter_en_retard[0].depuis,
      geste: { href: "/tablette", texte: "Ouvrir la tablette" },
    });
  }
  if (d.tablette_muette && d.restaurant?.en_service)
    a.push({ cle: "tablette", type: "tablette", niveau: "bloquant", titre: "La tablette ne répond plus", detail: "Sans elle, les commandes en ligne se mettent en pause seules.", geste: { href: "/tablette", texte: "Ouvrir la tablette" } });
  const pause = d.restaurant?.livraison.etat === "pause" ? d.restaurant.livraison : null;
  if (pause && pause.etat === "pause")
    a.push({ cle: "pause", type: "pause", niveau: "bloquant", titre: "Commandes en ligne en pause", detail: pause.jusqua ? `Jusqu'à ${heureDe(pause.jusqua)}.` : "Sans heure de fin.", geste: { href: "/tablette", texte: "Reprendre sur la tablette" } });
  for (const i of d.impression?.imprimantes ?? []) {
    if (i.actif && !i.en_ligne)
      a.push({ cle: `imprimante-${i.id}`, type: "impression", niveau: d.restaurant?.en_service ? "bloquant" : "attention", titre: `Imprimante ${i.nom} hors ligne`, depuis: i.vue_le ?? undefined, geste: { href: "/gestion/imprimantes", texte: "Voir les imprimantes" } });
  }
  if (d.impression && d.impression.echecs > 0)
    a.push({ cle: "tickets", type: "impression", niveau: "bloquant", titre: `${NB(d.impression.echecs, "ticket", "tickets")} pas imprimé${d.impression.echecs > 1 ? "s" : ""}`, geste: { href: "/tablette", texte: "Réimprimer sur la tablette" } });
  if (c && c.en_retard.length)
    a.push({ cle: "retard", type: "retard", niveau: "attention", titre: `${NB(c.en_retard.length, "commande", "commandes")} après l'heure promise`, detail: `N° ${c.en_retard.map((x) => x.numero).join(", ")}.`, depuis: c.en_retard[0].heure, geste: { href: "/tablette", texte: "Voir sur la tablette" } });
  if (d.livreurs_prevus === 0)
    a.push({
      cle: "livreurs",
      type: "livreurs",
      niveau: d.restaurant?.en_service ? "bloquant" : "attention",
      titre: `Aucun livreur prévu ${d.service === "midi" ? "ce midi" : "ce soir"}`,
      detail: "La livraison reste ouverte aux clients.",
      geste: { href: "/gestion/livreurs", texte: "Ouvrir le planning" },
    });
  const rs = d.remboursements;
  if (rs) {
    if (rs.echecs.length) {
      const commandes = commandesDe(rs.echecs);
      a.push({
        cle: "remboursements",
        type: "remboursements",
        niveau: "attention",
        titre: NB(rs.echecs.length, "remboursement a échoué", "remboursements ont échoué"),
        detail: commandes ? "Le client n'a pas été remboursé." : `Le client n'a pas été remboursé. N° ${[...new Set(rs.echecs.map((x) => x.numero))].join(", ")}.`,
        depuis: rs.echecs[0].cree_le,
        commandes,
        liste: { href: listeFiltree({ remboursement: "echec", ...periodeDe(commandes, d.jour) }), texte: "Voir la liste" },
      });
    }
    if (rs.bloques.length) {
      const commandes = commandesDe(rs.bloques);
      a.push({
        cle: "remboursements-en-cours",
        type: "remboursements",
        niveau: "attention",
        titre: `${NB(rs.bloques.length, "remboursement", "remboursements")} pas confirmé${rs.bloques.length > 1 ? "s" : ""} par Stripe depuis plus de 24 heures`,
        detail: commandes ? undefined : `N° ${[...new Set(rs.bloques.map((x) => x.numero))].join(", ")}.`,
        depuis: rs.bloques[0].cree_le,
        commandes,
        liste: { href: listeFiltree({ remboursement: "en_cours", ...periodeDe(commandes, d.jour) }), texte: "Voir la liste" },
      });
    }
  }
  const r = rs ? null : d.ventes?.periode.remboursements;
  if (r && r.echecs_ouverts > 0)
    a.push({ cle: "remboursements", type: "remboursements", niveau: "attention", titre: `${NB(r.echecs_ouverts, "remboursement a échoué", "remboursements ont échoué")} ${d.service === "midi" ? "ce midi" : "ce soir"}`, detail: "Le client n'a pas été remboursé.", geste: { href: "/gestion/commandes", texte: "Voir les commandes" } });
  if (r && r.en_cours > 0)
    a.push({ cle: "remboursements-en-cours", type: "remboursements", niveau: "attention", titre: `${NB(r.en_cours, "remboursement en cours", "remboursements en cours")} chez Stripe`, geste: { href: "/gestion/commandes", texte: "Voir les commandes" } });
  if (d.quota?.alerte)
    a.push({
      cle: "courriels",
      type: "courriels",
      niveau: d.quota.restants === 0 ? "bloquant" : "attention",
      titre: `E-mails : ${d.quota.envoyes} sur ${d.quota.plafond} envoyés aujourd'hui`,
      detail: d.quota.restants === 0 ? "Plus d'e-mail possible aujourd'hui : seuls les plus importants passent quand la limite se libère." : "Au-delà, seuls les e-mails les plus importants partent.",
    });
  if (d.hier_a_encaisser && d.hier_a_encaisser > 0)
    a.push({
      cle: "comptoir-hier",
      type: "comptoir",
      niveau: "attention",
      titre: `${NB(d.hier_a_encaisser, "commande", "commandes")} au comptoir des derniers jours pas notée${d.hier_a_encaisser > 1 ? "s" : ""} encaissée${d.hier_a_encaisser > 1 ? "s" : ""}`,
      detail: d.hier_a_encaisser > 1 ? "Elles manquent dans l'export comptable." : "Elle manque dans l'export comptable.",
      commandes: d.hier_a_encaisser_commandes?.length ? d.hier_a_encaisser_commandes : undefined,
      liste: { href: listeFiltree({ moyen: "comptoir", paiement: "a_encaisser_retrait", du: ajouterJours(d.jour, -7), au: ajouterJours(d.jour, -1) }), texte: "Voir la liste" },
    });
  return a.sort((x, y) => (x.niveau === y.niveau ? 0 : x.niveau === "bloquant" ? -1 : 1));
}

async function alerteMinutes(): Promise<number> {
  const r = await lirePublic<{ cle: string; valeur: unknown }>("reglages");
  const v = Number(r.find((x) => x.cle === "alerte_acceptation_minutes")?.valeur);
  if (!Number.isInteger(v) || v < 1) throw new Error("Réglage alerte_acceptation_minutes absent");
  return v;
}

// Les sept jours d'avant ne bougent presque plus : lus au plus une fois toutes les cinq minutes par instance,
// au lieu de toutes les 20 secondes par écran ouvert. Après un dimanche et un lundi fermés, le samedi compte encore.
// Même cache pour la liste des commandes au comptoir pas encaissées (leur numéro et leur jour) : une commande
// notée encaissée quitte l'alerte au plus tard cinq minutes après.
type Precedents = { ventes: TableauVentes | null; comptoir: CommandeAlerte[] | null };
let precedents: { jour: string; le: number; valeur: Promise<Precedents> } | null = null;
function joursPrecedents(jour: string): Promise<Precedents> {
  if (precedents && precedents.jour === jour && Date.now() - precedents.le < 5 * 60_000) return precedents.valeur;
  const [debut, fin] = [ajouterJours(jour, -7), ajouterJours(jour, -1)];
  const valeur = Promise.all([
    sur(fonctionSql<TableauVentes>("pilotage_ventes", { p_debut: debut, p_fin: fin, p_comp_debut: null, p_comp_fin: null, p_service: null })),
    sur(
      fonctionSql<{ lignes: LigneListe[] }>("liste_commandes_gestion", {
        p: { debut, fin, moyen: "comptoir", paiements: ["a_encaisser_retrait"], tri: "ancien", page: 1, par_page: 100 },
      }),
    ),
  ]).then(([ventes, liste]) => ({
    ventes,
    // Une commande refusée n'est pas à encaisser (même règle que pilotage_ventes).
    comptoir: liste ? liste.lignes.filter((l) => l.statut !== "refusee").map((l) => ({ id: l.id, numero: l.numero, jour: l.jour_service })) : null,
  }));
  precedents = { jour, le: Date.now(), valeur };
  // Une lecture ratée ne reste pas en cache.
  valeur.then((v) => {
    if ((v.ventes === null || v.comptoir === null) && precedents?.valeur === valeur) precedents = null;
  });
  return valeur;
}

/** La livraison est-elle ouverte à ce service, et pas encore finie ? Sinon l'absence de livreur ne dit rien. */
export function livraisonAuService(config: ConfigService, maintenant: Date, jour: string, service: Service): boolean {
  const etat = etatService(config, maintenant, "livraison").etat;
  if (etat === "livraison-fermee" || etat === "fermeture" || etat === "aucun-creneau") return false;
  const h = servicesDu(config, jour).find((x) => x.service === service);
  if (!h || instantGeneve(maintenant).minutes >= enMinutes(h.derniere_heure)) return false;
  return config.zones.some((z) => z.active && (!z.services || z.services.includes(service)));
}

export async function chargerAccueil(maintenant = new Date()): Promise<DonneesAccueil & { alertes: Alerte[] }> {
  const jour = jourDeService(maintenant);
  const service = serviceDe(maintenant);
  const [file, config, impression, quota, ventes, hier, catalogue, muette, minutes, aSuivre, planning] = await Promise.all([
    sur(fileTablette(maintenant)),
    sur(chargerConfigService()),
    sur(etatImpression()),
    sur(etatQuotaCourriels()),
    sur(fonctionSql<TableauVentes>("pilotage_ventes", { p_debut: jour, p_fin: jour, p_comp_debut: null, p_comp_fin: null, p_service: service })),
    joursPrecedents(jour),
    sur(chargerCatalogue()),
    sur(fonctionSql<boolean>("tablette_muette", { p_secondes: TABLETTE_MUETTE_S })),
    sur(alerteMinutes()),
    sur(fonctionSql<RemboursementASuivre[]>("remboursements_a_suivre", { p_heures: 24 })),
    sur(livreursDuService(jour, service)),
  ]);
  // Réglage illisible : 5 minutes, la valeur posée par la migration 20261111090000 (la même que la surveillance lit).
  const seuil = minutes ?? 5;
  const ruptures = catalogue
    ? Object.values(catalogue.plats)
        .filter((p) => p.rupture_motif)
        .map((p) => ({ nom: p.nom, jusqu_au: p.rupture_jusqu_au ?? null }))
    : [];
  const donnees: DonneesAccueil = {
    maintenant: maintenant.toISOString(),
    jour,
    service,
    commandes: file ? resumerCommandes(file, maintenant, seuil) : null,
    restaurant: config ? etatRestaurant(config, maintenant, ruptures) : null,
    ventes,
    hier_a_encaisser: hier.ventes?.periode.a_encaisser ?? null,
    hier_a_encaisser_commandes: hier.comptoir,
    impression: impression ? { imprimantes: impression.imprimantes, echecs: impression.taches.filter((t) => t.etat === "echec").length } : null,
    tablette_muette: muette,
    quota,
    alerte_acceptation_minutes: seuil,
    livreurs_prevus: config && planning && livraisonAuService(config, maintenant, jour, service) ? planning.filter((l) => l.present).length : null,
    remboursements: aSuivre
      ? {
          echecs: aSuivre.filter((x) => x.statut === "echec").map(({ numero, cree_le, commande_id, jour }) => ({ numero, cree_le, commande_id, jour })),
          bloques: aSuivre.filter((x) => x.statut === "en_cours").map(({ numero, cree_le, commande_id, jour }) => ({ numero, cree_le, commande_id, jour })),
        }
      : null,
  };
  return { ...donnees, alertes: alertesDe(donnees) };
}
