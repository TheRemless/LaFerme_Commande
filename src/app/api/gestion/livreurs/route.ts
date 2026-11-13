import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { appliquerNoms, nomsDistincts, type NomLivreur } from "@/lib/livreurs-noms";
import { exigerGerant } from "@/lib/personnel/session";
import { lirePlanning, lireStats, periode, reglerJour, reglerSemaine, type Resultat } from "@/lib/planning-livreurs";

// Livreurs au back-office (gérant) : planning et statistiques.
// GET ?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ (planning, 31 jours au plus ; sans date : aujourd'hui et 6 jours)
//   &stats_debut=…&stats_fin=… (statistiques, 93 jours au plus ; sans date : les 30 derniers jours).
// POST { type: "semaine", livreur, creneaux: [{ jour, service }] }
//    | { type: "jour", livreur, jour, service, present: true | false | null, motif? }
const SANS_CACHE = { "Cache-Control": "no-store, private" };

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const q = new URL(requete.url).searchParams;
  const p = periode(q.get("debut") ?? undefined, q.get("fin") ?? undefined, 31);
  const debutStats = q.get("stats_debut") ?? (p ? new Date(new Date(`${p.debut}T12:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10) : undefined);
  const s = periode(debutStats, q.get("stats_fin") ?? p?.debut, 93);
  if (!p || !s) return refus("Période invalide.", 400);
  const [planning, stats, noms] = await Promise.all([
    lirePlanning(p.debut, p.fin),
    lireStats(s.debut, s.fin),
    // Homonymes (« Nora » deux fois) : nom suivi du début de l'e-mail. Base pas encore migrée : noms tels quels.
    fonctionSql<NomLivreur[]>("noms_livreurs", {}).catch(() => [] as NomLivreur[]),
  ]);
  const distincts = nomsDistincts(noms);
  return NextResponse.json(
    { periode: p, periode_stats: s, ...appliquerNoms(planning, distincts), stats: appliquerNoms(stats, distincts) },
    { headers: SANS_CACHE },
  );
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const r: Resultat =
    c.type === "semaine"
      ? await reglerSemaine(g.personnel, c.livreur, c.creneaux)
      : c.type === "jour"
        ? await reglerJour(g.personnel, c.livreur, c.jour, c.service, c.present ?? null, c.motif)
        : { ok: false, erreur: "Type inconnu." };
  if (!r.ok) return refus(r.erreur, r.code);
  return NextResponse.json({ enregistre: true }, { headers: SANS_CACHE });
}
