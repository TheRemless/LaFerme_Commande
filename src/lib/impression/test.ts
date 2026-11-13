import "server-only";
import { fonctionSql } from "@/lib/db/serveur";
import type { Personnel } from "@/lib/personnel/session";

// Ticket de test (vague 3, demandé par bo-operations pour le back-office) : une tâche « essai » sans commande,
// « TEST », poste, nom de l'imprimante, date et heure, qui l'a demandé. Elle part par CloudPRNT et se confirme
// comme une autre. Base : ticket_de_test(smallint, uuid), 20261203110000_ticket_de_test.sql (gérant revérifié).

const MESSAGES: [RegExp, string][] = [
  [/Réservé au gérant/, "Réservé au gérant."],
  [/Imprimante inconnue/, "Imprimante inconnue."],
  [/Imprimante désactivée/, "Imprimante désactivée : réactivez-la avant le test."],
];

export async function imprimerTicketTest(imprimanteId: number, personnel: Personnel): Promise<{ ok: true; tache: string } | { ok: false; erreur: string }> {
  if (!Number.isInteger(imprimanteId) || imprimanteId <= 0 || imprimanteId > 32767) return { ok: false, erreur: "Imprimante inconnue." };
  try {
    const tache = await fonctionSql<string>("ticket_de_test", { p_imprimante: imprimanteId, p_personnel: personnel.id });
    return { ok: true, tache };
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    const connu = MESSAGES.find(([motif]) => motif.test(texte));
    if (connu) return { ok: false, erreur: connu[1] };
    throw e;
  }
}
