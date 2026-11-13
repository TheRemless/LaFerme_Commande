import "server-only";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { alerter, dansUnService } from "@/lib/surveillance";
import { agir, rafraichirCaches } from "@/lib/tablette";

// Décision C13 de Jérémy (13.11.2026) : une commande « dès que possible » que personne n'accepte dans le délai
// (réglage refus_automatique_minutes, 15 au départ) est refusée comme sur la tablette. Payée en ligne, elle est
// remboursée en entier ; le client reçoit l'e-mail de refus ou de remboursement. Les commandes en ligne se
// mettent en pause et le gérant reçoit une alerte. Seulement pendant un service, jamais pour une commande à une
// heure choisie. Interrupteur refus_automatique_actif au back-office.
// Doc : docs/vague-3/client-commande.md, « Commande que personne n'accepte ».
//
// Lancé par la fonction planifiée (route /api/surveillance), jamais dans une requête de la tablette ou d'une
// imprimante. Un tour est court (relecture de qualite) : la pause et l'alerte d'abord, puis au plus
// REFUS_PAR_TOUR commandes dans un budget de temps ; les autres attendent le tour suivant, une minute plus tard.
// Une fonction coupée entre le refus et le remboursement est rattrapée au tour suivant (reprendreRemboursements).

const REFUS_PAR_TOUR = 3;
const BUDGET_MS = 4000;

// Le geste est noté « tablette:Refus automatique » dans l'historique de la commande (evenements_commande.par) :
// c'est à ce nom que la reprise retrouve ses refus. Aucun compte derrière ; un refus de commande nouvelle et un
// remboursement n'utilisent que ce nom.
const REFUS_AUTOMATIQUE: Personnel = { id: "00000000-0000-0000-0000-000000000000", email: "", nom: "Refus automatique", role: "service" };

// Texte lu par le client, au suivi et dans l'e-mail, après « Nous ne pouvons pas préparer votre commande n° 42. ».
export function motifRefusAutomatique(minutes: number): string {
  return `Elle attendait depuis ${minutes} minutes sans confirmation de notre part. Pour commander quand même, appelez-nous au 022 792 16 89.`;
}

type Ref = { id: string; numero: number };

async function lire<T>(fonction: string, vide: T): Promise<T> {
  try {
    return (await fonctionSql<T>(fonction, {})) ?? vide;
  } catch (e) {
    // Avant la migration, la fonction n'existe pas : rien à faire.
    const m = e instanceof Error ? e.message : String(e);
    if (!/does not exist|Could not find the function/i.test(m)) console.error(`Refus automatique (${fonction}) : ${m}`);
    return vide;
  }
}

export async function refuserCommandesSansReponse(fin = Date.now() + BUDGET_MS): Promise<number[]> {
  const a = await lire<{ minutes: number; commandes: Ref[] }>("commandes_sans_reponse", { minutes: 15, commandes: [] });
  if (a.commandes.length === 0) return [];

  // D'abord la pause et l'alerte : même si la suite est coupée, plus rien n'arrive et le gérant le sait.
  // L'alerte part quand la pause commence ; une pause déjà en cours (datée, sans fin, tour précédent) reste telle quelle.
  const pause = await fonctionSql<boolean>("pause_automatique", {}).catch((e) => {
    console.error(`Pause avant un refus automatique : ${e instanceof Error ? e.message : e}`);
    return false;
  });
  if (pause) {
    rafraichirCaches("config-service");
    const numeros = a.commandes.map((c) => c.numero).join(", ");
    const plusieurs = a.commandes.length > 1;
    await alerter(plusieurs ? `Commandes ${numeros} refusées : personne ne les a acceptées` : `Commande ${numeros} refusée : personne ne l'a acceptée`, [
      `${plusieurs ? "Les commandes" : "La commande"} ${numeros} ${plusieurs ? "attendent" : "attend"} depuis plus de ${a.minutes} minutes sur la tablette. ${plusieurs ? "Elles sont refusées" : "Elle est refusée"} et le client est prévenu par e-mail. Une commande payée en ligne est remboursée en entier.`,
      "Les commandes en ligne sont en pause. Regardez la tablette, puis touchez « Reprendre les commandes ».",
    ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
  }

  const refusees: number[] = [];
  for (const c of a.commandes.slice(0, REFUS_PAR_TOUR)) {
    if (Date.now() >= fin) break;
    // de « nouvelle » : acceptée sur la tablette à la dernière seconde, elle n'est pas refusée (SS-06).
    const r = await agir(c.id, { action: "refuser", motif: motifRefusAutomatique(a.minutes), de: "nouvelle" }, REFUS_AUTOMATIQUE).catch((e) => {
      console.error(`Refus automatique de la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
      return { ok: false };
    });
    if (r.ok) refusees.push(c.numero);
  }
  return refusees;
}

// Refus automatique payé en ligne mais pas remboursé depuis plus de 2 minutes (fonction coupée entre les deux,
// Stripe en panne) : remboursement relancé, une commande à la fois. rembourserCommande ne rembourse pas deux
// fois ; réussi, il envoie l'e-mail de remboursement au client. Au premier échec, une alerte au gérant.
export async function reprendreRemboursements(fin = Date.now() + BUDGET_MS): Promise<number[]> {
  const a = await lire<(Ref & { premiere: boolean })[]>("refus_automatiques_a_rembourser", []);
  const repris: number[] = [];
  for (const c of a) {
    if (Date.now() >= fin) break;
    const r = await agir(c.id, { action: "rembourser" }, REFUS_AUTOMATIQUE).catch((e) => {
      console.error(`Remboursement repris de la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
      return { ok: false };
    });
    if (r.ok) repris.push(c.numero);
    else if (c.premiere) {
      await alerter(`Commande ${c.numero} : remboursement à refaire`, [
        `La commande ${c.numero} a été refusée automatiquement, mais son remboursement n'est pas passé.`,
        "Sur la tablette, onglet « Terminées », touchez « Rembourser ». Si ça ne passe toujours pas, remboursez depuis Stripe.",
      ], "alerte", "remboursement").catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
    }
  }
  return repris;
}

// Un tour, depuis la route de la fonction planifiée. Refus pendant un service seulement ; la reprise des
// remboursements, toujours. Budget partagé.
export async function tourRefusAutomatique(maintenant = new Date()): Promise<{ refusees: number[]; repris: number[] }> {
  const fin = Date.now() + BUDGET_MS;
  const service = dansUnService(await chargerConfigService(), maintenant);
  const refusees = service ? await refuserCommandesSansReponse(fin) : [];
  const repris = await reprendreRemboursements(fin);
  return { refusees, repris };
}
