import "server-only";
import { chargerConfigService } from "@/lib/config-service";
import { reconcilier } from "@/lib/commandes";
import { finCoupDeFeuEchue } from "@/lib/coup-de-feu";
import { courrielConfigure, envoyerParSmtp } from "@/lib/courriel/envoi";
import { QuotaAtteint, type TypeCourriel } from "@/lib/courriel/quota";
import { commandeParId, enregistrerCourriel, fonctionSql } from "@/lib/db/serveur";
import { imprimerCommandesDues } from "@/lib/impression/service";
import { destinataireAlertes } from "@/lib/reglages-generaux";
import { etatService, type ConfigService } from "@/lib/service";
import { rafraichirCaches } from "@/lib/tablette";

// Surveillance du service, une fois par minute au plus, déclenchée par les passages des imprimantes,
// les relectures de la tablette et, en production, une fonction planifiée Netlify.
// 1. Une commande du jour attend d'être acceptée depuis plus que le délai réglé : alerte au restaurant.
// 2. La tablette ne donne plus signe de vie pendant le service : pause des commandes en ligne et alerte.
// 3. Chaque nuit, les réglages du soir reviennent à la normale (remise_du_jour).
// 4. Les commandes acceptées à l'avance reçoivent leurs tickets à l'heure prévue (SS-11), pause ou non :
//    une commande acceptée doit être préparée.
// 5. Un coup de feu dont l'heure est passée prend fin (retard, capacité, livraison rendus).
// 6. Un paiement en ligne dont la confirmation de Stripe n'est jamais arrivée est relu chez Stripe : la
//    commande payée apparaît sur la tablette même si le webhook s'est perdu et que le client est parti.

const TABLETTE_MUETTE_S = 180;

// Courriel au restaurant (adresse des réglages généraux, sinon ALERTE_EMAIL). Sans serveur d'envoi, gardé en base comme les autres courriels de test.
export async function alerter(sujet: string, lignes: string[], type: TypeCourriel = "alerte"): Promise<void> {
  const texte = [...lignes, "", "Site de commande La Ferme"].join("\n");
  const html = `<pre>${texte.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`;
  // L'adresse saisie au back-office (réglages généraux), sinon la variable ALERTE_EMAIL.
  const destinataire = await destinataireAlertes();
  let fournisseur = courrielConfigure() && destinataire ? "smtp" : "doublure";
  if (fournisseur === "smtp") {
    try {
      await envoyerParSmtp(destinataire!, sujet, texte, html, { type });
    } catch (e) {
      // Limite du jour : l'alerte ne part pas par e-mail, mais sa copie reste pour le back-office.
      if (!(e instanceof QuotaAtteint)) throw e;
      console.error(`Alerte non envoyée (limite d'e-mails du jour) : ${sujet}`);
      fournisseur = "quota";
    }
  } else {
    console.error(`Alerte (aucun courriel configuré) : ${sujet}`);
  }
  await enregistrerCourriel({
    commande_id: null,
    destinataire: destinataire ?? "restaurant",
    sujet,
    texte,
    html,
    fournisseur,
  });
}

// Appelée à chaque passage d'imprimante et à chaque relecture de la tablette : une fois par minute au
// plus par instance de fonction, pour ne pas payer un appel à la base à chaque passage. En production,
// la fonction planifiée (netlify/functions/surveillance.mts) la lance de toute façon chaque minute.
let dernierTour = 0;
export async function surveillanceAuPassage(): Promise<void> {
  const t = Date.now();
  if (t - dernierTour < 60_000) return;
  dernierTour = t;
  await executerSurveillance().catch((e) => console.error(`Surveillance : ${e instanceof Error ? e.message : e}`));
}

// Le restaurant est-il dans les heures d'un service, pause ou non ? Hors service, la tablette éteinte et une
// commande pour plus tard sont normales : ni alerte, ni pause automatique (SS-09).
export function dansUnService(config: ConfigService, maintenant: Date): boolean {
  return etatService({ ...config, pause: undefined }, maintenant, "retrait").etat === "ouvert";
}

// Paiements dont Stripe n'a pas confirmé l'issue au site (6). Avant la migration 20261204090000, la fonction
// n'existe pas : rien à rattraper. Budget de temps : un Stripe lent ne retient pas le tour de surveillance
// (ni la relecture de la tablette qui l'a déclenché) plus de quelques secondes ; le reste attend le tour suivant.
const BUDGET_RATTRAPAGE_MS = 6000;
const DELAI_PAR_PAIEMENT_MS = 4000;

export async function rattraperPaiements(): Promise<number> {
  let ids: string[];
  try {
    ids = (await fonctionSql<string[] | null>("paiements_a_rattraper", {})) ?? [];
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!/does not exist|Could not find the function/i.test(m)) console.error(`Paiements à rattraper : ${m}`);
    return 0;
  }
  let rattrapes = 0;
  const fin = Date.now() + BUDGET_RATTRAPAGE_MS;
  for (const id of ids) {
    if (Date.now() >= fin) break;
    try {
      const c = await commandeParId(id);
      if (!c) continue;
      const apres = await Promise.race([
        reconcilier(c),
        new Promise<never>((_, non) => setTimeout(() => non(new Error("Stripe ne répond pas à temps")), DELAI_PAR_PAIEMENT_MS)),
      ]);
      // Seul un paiement confirmé compte : une session abandonnée qui expire n'est pas un paiement perdu.
      if (c.statut_paiement !== "paye" && apres.statut_paiement === "paye") {
        rattrapes += 1;
        console.error(`Commande ${c.numero} : paiement rattrapé par la surveillance (confirmation de Stripe jamais reçue).`);
      }
    } catch (e) {
      console.error(`Paiement à rattraper (${id}) : ${e instanceof Error ? e.message : e}`);
    }
  }
  return rattrapes;
}

export async function executerSurveillance(maintenant = new Date()): Promise<{ fait: boolean; retards: number; pause: boolean; imprimees: number; rattrapes: number }> {
  if (!(await fonctionSql<boolean>("tour_de_surveillance", {}))) return { fait: false, retards: 0, pause: false, imprimees: 0, rattrapes: 0 };

  // D'abord les tickets : une alerte ou une pause qui échoue ne doit pas retarder la cuisine.
  const imprimees = await imprimerCommandesDues().catch((e) => {
    console.error(`Impression des commandes à l'avance : ${e instanceof Error ? e.message : e}`);
    return 0;
  });

  // Premier tour d'un nouveau jour de service (5h, heure de Genève) : livraison rouverte, retard à zéro,
  // pause manuelle sans fin levée (audit du gérant, G06). La pause automatique reste.
  const remise = await fonctionSql<Record<string, unknown> | null>("remise_du_jour", {}).catch((e) => {
    console.error(`Remise du jour : ${e instanceof Error ? e.message : e}`);
    return null;
  });
  if (remise) rafraichirCaches("config-service");

  // Coup de feu dont l'heure de fin est passée : retard, capacité et livraison reviennent (vague 3).
  // Avant la migration 20261130090000, la fonction n'existe pas : rien à finir, rien à signaler.
  await finCoupDeFeuEchue().catch((e) => {
    const m = e instanceof Error ? e.message : String(e);
    if (!/does not exist|Could not find the function/i.test(m)) console.error(`Fin du coup de feu : ${m}`);
  });

  const config = await chargerConfigService();
  const service = dansUnService(config, maintenant);
  const retards = service ? await fonctionSql<{ numero: number; cree_le: string }[]>("commandes_en_retard", {}) : [];
  if (retards.length) {
    const numeros = retards.map((r) => r.numero).join(", ");
    await alerter(retards.length > 1 ? `Commandes ${numeros} pas encore acceptées` : `Commande ${numeros} pas encore acceptée`, [
      `${retards.length > 1 ? "Les commandes" : "La commande"} ${numeros} ${retards.length > 1 ? "attendent" : "attend"} sur la tablette.`,
      "Le client n'a pas encore d'heure confirmée.",
    ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
  }

  let pause = false;
  // pause_automatique ne remplace pas une pause en cours (datée ou sans fin) : elle n'agit que si les
  // commandes en ligne sont ouvertes.
  if (service && (await fonctionSql<boolean>("tablette_muette", { p_secondes: TABLETTE_MUETTE_S })) && (await fonctionSql<boolean>("pause_automatique", {}))) {
    pause = true;
    rafraichirCaches("config-service");
    await alerter("Tablette injoignable : commandes en ligne en pause", [
      "La tablette ne répond plus depuis plus de 3 minutes.",
      "Les commandes en ligne sont en pause. Rallumez la tablette, puis touchez « Reprendre les commandes ».",
    ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
  }
  // En dernier, les paiements perdus (appels à Stripe) : un Stripe lent ne retarde ni la pause automatique
  // ni les alertes ci-dessus.
  const rattrapes = await rattraperPaiements();
  return { fait: true, retards: retards.length, pause, imprimees, rattrapes };
}
