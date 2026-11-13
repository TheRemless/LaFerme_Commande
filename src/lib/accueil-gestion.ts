// Accueil du back-office : la journée en un coup d'œil (vague 3, bo-socle). Lundi 9h ou vendredi 20h, le
// gérant voit en dix secondes ce qui demande un geste. Ce module ne fait que rassembler ce qui existe :
// file de la tablette, état du service, impression, quota d'e-mails, ventes (pilotage_ventes, bo-pilotage).
// Une source en panne ne vide pas l'accueil : sa partie vaut null et l'écran dit « indisponible ».

import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { etatQuotaCourriels, type EtatQuota } from "@/lib/courriel/quota";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { heureDe } from "@/lib/heures";
import { etatImpression, type EtatImpression } from "@/lib/impression/service";
import { jourDeService, serviceDe, type Service, type TableauVentes } from "@/lib/pilotage";
import { ajouterJours, etatService, serviceEnCours, zoneFermeeJusqua, type ConfigService, type EtatService } from "@/lib/service";
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

export type DonneesAccueil = {
  maintenant: string;
  jour: string;
  service: Service;
  commandes: ResumeCommandes | null;
  restaurant: EtatRestaurant | null;
  ventes: TableauVentes | null;
  /** Commandes au comptoir des sept jours d'avant pas notées encaissées (jours fermés compris). */
  hier_a_encaisser: number | null;
  impression: Pick<EtatImpression, "imprimantes"> & { echecs: number } | null;
  tablette_muette: boolean | null;
  quota: EtatQuota | null;
  alerte_acceptation_minutes: number;
};

export type Alerte = {
  cle: string;
  /** « bloquant » : le service en souffre maintenant. « attention » : à régler aujourd'hui. */
  niveau: "bloquant" | "attention";
  titre: string;
  detail?: string;
  depuis?: string;
  geste?: { href: string; texte: string };
};

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

/** Ce qui demande un geste, du plus urgent au moins urgent. Pur : testé dans tests/unit/accueil-gestion.test.ts. */
export function alertesDe(d: DonneesAccueil): Alerte[] {
  const a: Alerte[] = [];
  const c = d.commandes;
  if (c && c.a_accepter_en_retard.length) {
    const n = c.a_accepter_en_retard.map((x) => x.numero).join(", ");
    a.push({
      cle: "a-accepter",
      niveau: "bloquant",
      titre: c.a_accepter_en_retard.length > 1 ? `Commandes ${n} pas encore acceptées` : `Commande ${n} pas encore acceptée`,
      detail: `Plus de ${d.alerte_acceptation_minutes} min d'attente.`,
      depuis: c.a_accepter_en_retard[0].depuis,
      geste: { href: "/tablette", texte: "Ouvrir la tablette" },
    });
  }
  if (d.tablette_muette && d.restaurant?.en_service)
    a.push({ cle: "tablette", niveau: "bloquant", titre: "La tablette ne répond plus", detail: "Sans elle, les commandes en ligne se mettent en pause seules.", geste: { href: "/tablette", texte: "Ouvrir la tablette" } });
  const pause = d.restaurant?.livraison.etat === "pause" ? d.restaurant.livraison : null;
  if (pause && pause.etat === "pause")
    a.push({ cle: "pause", niveau: "bloquant", titre: "Commandes en ligne en pause", detail: pause.jusqua ? `Jusqu'à ${heureDe(pause.jusqua)}.` : "Sans heure de fin.", geste: { href: "/tablette", texte: "Reprendre sur la tablette" } });
  for (const i of d.impression?.imprimantes ?? []) {
    if (i.actif && !i.en_ligne)
      a.push({ cle: `imprimante-${i.id}`, niveau: d.restaurant?.en_service ? "bloquant" : "attention", titre: `Imprimante ${i.nom} hors ligne`, depuis: i.vue_le ?? undefined, geste: { href: "/gestion/imprimantes", texte: "Voir les imprimantes" } });
  }
  if (d.impression && d.impression.echecs > 0)
    a.push({ cle: "tickets", niveau: "bloquant", titre: `${NB(d.impression.echecs, "ticket", "tickets")} pas imprimé${d.impression.echecs > 1 ? "s" : ""}`, geste: { href: "/tablette", texte: "Réimprimer sur la tablette" } });
  if (c && c.en_retard.length)
    a.push({ cle: "retard", niveau: "attention", titre: `${NB(c.en_retard.length, "commande", "commandes")} après l'heure promise`, detail: `N° ${c.en_retard.map((x) => x.numero).join(", ")}.`, depuis: c.en_retard[0].heure, geste: { href: "/tablette", texte: "Voir sur la tablette" } });
  const r = d.ventes?.periode.remboursements;
  if (r && r.echecs_ouverts > 0)
    a.push({ cle: "remboursements", niveau: "attention", titre: `${NB(r.echecs_ouverts, "remboursement a échoué", "remboursements ont échoué")} ${d.service === "midi" ? "ce midi" : "ce soir"}`, detail: "Le client n'a pas été remboursé.", geste: { href: "/gestion/commandes", texte: "Voir les commandes" } });
  if (r && r.en_cours > 0)
    a.push({ cle: "remboursements-en-cours", niveau: "attention", titre: `${NB(r.en_cours, "remboursement en cours", "remboursements en cours")} chez Stripe`, geste: { href: "/gestion/commandes", texte: "Voir les commandes" } });
  if (d.quota?.alerte)
    a.push({
      cle: "courriels",
      niveau: d.quota.restants === 0 ? "bloquant" : "attention",
      titre: `E-mails : ${d.quota.envoyes} sur ${d.quota.plafond} envoyés aujourd'hui`,
      detail: d.quota.restants === 0 ? "Plus d'e-mail possible aujourd'hui : seuls les plus importants passent quand la limite se libère." : "Au-delà, seuls les e-mails les plus importants partent.",
    });
  if (d.hier_a_encaisser && d.hier_a_encaisser > 0)
    a.push({ cle: "comptoir-hier", niveau: "attention", titre: `${NB(d.hier_a_encaisser, "commande", "commandes")} au comptoir des derniers jours pas notée${d.hier_a_encaisser > 1 ? "s" : ""} encaissée${d.hier_a_encaisser > 1 ? "s" : ""}`, detail: d.hier_a_encaisser > 1 ? "Elles manquent dans l'export comptable." : "Elle manque dans l'export comptable.", geste: { href: "/gestion/commandes", texte: "Voir les commandes" } });
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
let precedents: { jour: string; le: number; valeur: Promise<TableauVentes | null> } | null = null;
function joursPrecedents(jour: string): Promise<TableauVentes | null> {
  if (precedents && precedents.jour === jour && Date.now() - precedents.le < 5 * 60_000) return precedents.valeur;
  const valeur = sur(fonctionSql<TableauVentes>("pilotage_ventes", { p_debut: ajouterJours(jour, -7), p_fin: ajouterJours(jour, -1), p_comp_debut: null, p_comp_fin: null, p_service: null }));
  precedents = { jour, le: Date.now(), valeur };
  // Une lecture ratée ne reste pas en cache.
  valeur.then((v) => {
    if (v === null && precedents?.valeur === valeur) precedents = null;
  });
  return valeur;
}

export async function chargerAccueil(maintenant = new Date()): Promise<DonneesAccueil & { alertes: Alerte[] }> {
  const jour = jourDeService(maintenant);
  const service = serviceDe(maintenant);
  const [file, config, impression, quota, ventes, hier, catalogue, muette, minutes] = await Promise.all([
    sur(fileTablette(maintenant)),
    sur(chargerConfigService()),
    sur(etatImpression()),
    sur(etatQuotaCourriels()),
    sur(fonctionSql<TableauVentes>("pilotage_ventes", { p_debut: jour, p_fin: jour, p_comp_debut: null, p_comp_fin: null, p_service: service })),
    joursPrecedents(jour),
    sur(chargerCatalogue()),
    sur(fonctionSql<boolean>("tablette_muette", { p_secondes: TABLETTE_MUETTE_S })),
    sur(alerteMinutes()),
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
    hier_a_encaisser: hier?.periode.a_encaisser ?? null,
    impression: impression ? { imprimantes: impression.imprimantes, echecs: impression.taches.filter((t) => t.etat === "echec").length } : null,
    tablette_muette: muette,
    quota,
    alerte_acceptation_minutes: seuil,
  };
  return { ...donnees, alertes: alertesDe(donnees) };
}
