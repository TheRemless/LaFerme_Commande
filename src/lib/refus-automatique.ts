import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";
import { alerter } from "@/lib/surveillance";
import { agir, rafraichirCaches } from "@/lib/tablette";

// Décision C13 de Jérémy (13.11.2026) : une commande « dès que possible » que personne n'accepte dans le délai
// (réglage refus_automatique_minutes, 15 au départ) est refusée comme sur la tablette. Payée en ligne, elle est
// remboursée en entier ; le client reçoit l'e-mail de refus ou de remboursement. Puis les commandes en ligne se
// mettent en pause et le gérant reçoit une alerte. Seulement pendant un service (la surveillance le vérifie),
// jamais pour une commande à une heure choisie. Interrupteur refus_automatique_actif au back-office.
// Doc : docs/vague-3/client-commande.md, « Commande que personne n'accepte ».

// Le geste est noté « tablette:Refus automatique » dans l'historique de la commande. Aucun compte derrière :
// le refus d'une commande nouvelle n'utilise que ce nom.
const REFUS_AUTOMATIQUE: Personnel = { id: "00000000-0000-0000-0000-000000000000", email: "", nom: "Refus automatique", role: "service" };

// Texte lu par le client, au suivi et dans l'e-mail, après « Nous ne pouvons pas préparer votre commande n° 42. ».
export function motifRefusAutomatique(minutes: number): string {
  return `Elle attendait depuis ${minutes} minutes sans confirmation de notre part. Pour commander quand même, appelez-nous au 022 792 16 89.`;
}

type SansReponse = { minutes: number; commandes: { id: string; numero: number }[] };

export async function refuserCommandesSansReponse(): Promise<number[]> {
  let a: SansReponse;
  try {
    a = await fonctionSql<SansReponse>("commandes_sans_reponse", {});
  } catch (e) {
    // Avant la migration, la fonction n'existe pas : rien à refuser.
    const m = e instanceof Error ? e.message : String(e);
    if (!/does not exist|Could not find the function/i.test(m)) console.error(`Refus automatique : ${m}`);
    return [];
  }
  const refusees: number[] = [];
  for (const c of a.commandes) {
    // de « nouvelle » : acceptée sur la tablette à la dernière seconde, elle n'est pas refusée (SS-06).
    const r = await agir(c.id, { action: "refuser", motif: motifRefusAutomatique(a.minutes), de: "nouvelle" }, REFUS_AUTOMATIQUE).catch((e) => {
      console.error(`Refus automatique de la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
      return { ok: false };
    });
    if (r.ok) refusees.push(c.numero);
  }
  if (refusees.length === 0) return refusees;

  // Personne ne regarde la tablette : les commandes suivantes attendraient de même. Une pause déjà en cours
  // (datée ou sans fin) reste telle quelle.
  const pause = await fonctionSql<boolean>("pause_automatique", {}).catch((e) => {
    console.error(`Pause après un refus automatique : ${e instanceof Error ? e.message : e}`);
    return false;
  });
  if (pause) rafraichirCaches("config-service");
  const numeros = refusees.join(", ");
  const plusieurs = refusees.length > 1;
  await alerter(plusieurs ? `Commandes ${numeros} refusées : personne ne les a acceptées` : `Commande ${numeros} refusée : personne ne l'a acceptée`, [
    `${plusieurs ? "Les commandes" : "La commande"} ${numeros} ${plusieurs ? "attendaient" : "attendait"} depuis ${a.minutes} minutes sur la tablette. ${plusieurs ? "Elles sont refusées" : "Elle est refusée"} et le client est prévenu par e-mail. Une commande payée en ligne est remboursée en entier.`,
    pause
      ? "Les commandes en ligne sont en pause. Regardez la tablette, puis touchez « Reprendre les commandes »."
      : "Regardez la tablette : d'autres commandes peuvent attendre.",
  ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
  return refusees;
}
