import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

// Messages d'information aux clients, au back-office (gérant, vague 3). Doc : docs/messages-clients.md.
// GET : les messages pas finis et ceux des 30 derniers jours.
// POST { type: "ajouter", texte, debut?, fin, emplacement? } | { type: "retirer", id }
const SANS_CACHE = { "Cache-Control": "no-store, private" };

const MESSAGES_SQL: [RegExp, string][] = [
  [/Texte/, "Le texte fait de 5 à 200 caractères."],
  [/Début/, "Début : maintenant ou dans les 60 jours."],
  [/Fin/, "Fin : après le début, 60 jours au plus."],
  [/Emplacement/, "Emplacement : l'accueil ou tout le site."],
  [/Cinq messages/, "Cinq messages au plus en même temps : retirez-en un d'abord."],
];

const date = (v: unknown) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json({ messages: await fonctionSql<unknown[]>("messages_gestion", {}) }, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  if (c.type === "ajouter") {
    const texte = typeof c.texte === "string" ? c.texte.replace(/\s+/g, " ").trim() : "";
    if (texte.length < 5 || texte.length > 200) return refus("Le texte fait de 5 à 200 caractères.");
    const fin = date(c.fin);
    if (!fin) return refus("Indiquez la fin du message.");
    const debut = c.debut === undefined || c.debut === null ? null : date(c.debut);
    if (c.debut && !debut) return refus("Début illisible.");
    const emplacement = c.emplacement === "partout" ? "partout" : c.emplacement === undefined || c.emplacement === "accueil" ? "accueil" : null;
    if (!emplacement) return refus("Emplacement : l'accueil ou tout le site.");
    try {
      const id = await fonctionSql<number>("ajouter_message_client", { p: { texte, debut, fin, emplacement }, p_personnel: g.personnel.id });
      rafraichirCaches("config-service");
      return NextResponse.json({ enregistre: true, id }, { headers: SANS_CACHE });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      const trouve = MESSAGES_SQL.find(([r]) => r.test(m));
      if (trouve) return refus(trouve[1]);
      throw e;
    }
  }
  if (c.type === "retirer") {
    if (!Number.isInteger(c.id) || (c.id as number) < 1) return refus("Message inconnu.", 404);
    const ok = await fonctionSql<boolean>("retirer_message_client", { p_id: c.id, p_personnel: g.personnel.id });
    if (ok) rafraichirCaches("config-service");
    return NextResponse.json({ enregistre: ok, deja: !ok }, { headers: SANS_CACHE });
  }
  return refus("Type inconnu.");
}
