// Messages d'information aux clients (vague 3, bo-operations) : une bannière programmée. Fonctions pures,
// mêmes résultats dans le navigateur et sur le serveur. Doc : docs/messages-clients.md.

export type MessageClient = { id: number; texte: string; debut: string; fin: string; emplacement: "accueil" | "partout" };
export type Page = "accueil" | "carte" | "panier" | "paiement";

// Réponse de messages_actifs(), ou [] si elle est absente ou illisible.
export function lireMessages(brut: unknown): MessageClient[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const x = m as Record<string, unknown>;
    const date = (v: unknown) => (typeof v === "string" || v instanceof Date ? new Date(v) : null);
    const debut = date(x.debut);
    const fin = date(x.fin);
    if (typeof x.id !== "number" || typeof x.texte !== "string" || !debut || !fin || Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) return [];
    if (x.emplacement !== "accueil" && x.emplacement !== "partout") return [];
    return [{ id: x.id, texte: x.texte, debut: debut.toISOString(), fin: fin.toISOString(), emplacement: x.emplacement }];
  });
}

// Messages à montrer maintenant sur une page : commencés, pas finis ; « accueil » seulement sur l'accueil.
// Comparés à l'heure réelle, comme la pause : l'heure simulée des préversions ne les change pas.
export function messagesVisibles(messages: MessageClient[] | undefined, page: Page, reel = Date.now()): MessageClient[] {
  return (messages ?? []).filter(
    (m) => new Date(m.debut).getTime() <= reel && reel < new Date(m.fin).getTime() && (m.emplacement === "partout" || page === "accueil"),
  );
}
