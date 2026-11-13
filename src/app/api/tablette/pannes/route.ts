import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { jourGeneveDe } from "@/lib/heures";
import { exigerPersonnel } from "@/lib/personnel/session";
import { rafraichirCaches, signalerTablette } from "@/lib/tablette";

// « Four en panne… » sur la tablette (vague 3, arbitrage du chef : même fonction que le back-office de bo-carte) :
// tout un poste ou une catégorie épuisé jusqu'à ce soir ou demain soir, en un geste confirmé. Base de bo-carte
// (20261210090000_disponibilites.sql) : ruptures_groupees_actives(), regler_rupture_groupee(cible, jusqu_au,
// personnel). Les ruptures plat par plat restent intactes quand on remet en vente. Avant cette migration : vide.
// GET : { ruptures: [{ cible, jusqu_au }], categories: [{ slug, nom }] }.
// POST { cible: "poste:pizza" | "poste:cuisine" | "categorie:<slug>", jusqu: "ce-soir" | "demain" | null } (null : remettre en vente).
const SANS_CACHE = { "Cache-Control": "no-store" };

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const [ruptures, carte] = await Promise.all([
    fonctionSql<{ cible: string; jusqu_au: string }[]>("ruptures_groupees_actives", {}).catch(() => []),
    lirePublic<{ categorie_slug: string; categorie_nom: string; categorie_ordre: number }>("carte_publique").catch(() => []),
  ]);
  const categories = new Map<string, { slug: string; nom: string; ordre: number }>();
  for (const p of carte) if (p.categorie_slug !== "plat-du-jour") categories.set(p.categorie_slug, { slug: p.categorie_slug, nom: p.categorie_nom, ordre: p.categorie_ordre });
  return NextResponse.json(
    { ruptures, categories: [...categories.values()].sort((a, b) => a.ordre - b.ordre).map(({ slug, nom }) => ({ slug, nom })) },
    { headers: SANS_CACHE },
  );
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.cible !== "string" || !/^(poste:(pizza|cuisine)|categorie:[a-z0-9-]{1,40})$/.test(c.cible)) return refus("Poste ou catégorie inconnu.");
  if (c.jusqu !== null && c.jusqu !== "ce-soir" && c.jusqu !== "demain") return refus("Durée inconnue.");
  const aujourdHui = jourGeneveDe(new Date());
  // Le jour de Genève plus un : midi UTC évite tout saut d'heure.
  const demain = new Date(Date.parse(`${aujourdHui}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const jusquAu = c.jusqu === null ? null : c.jusqu === "ce-soir" ? aujourdHui : demain;
  const ok = await fonctionSql<boolean>("regler_rupture_groupee", { p_cible: c.cible, p_jusqu_au: jusquAu, p_personnel: g.personnel.id });
  if (!ok) return refus("Poste ou catégorie inconnu.");
  rafraichirCaches("catalogue");
  await signalerTablette();
  return NextResponse.json({ enregistre: true, jusqu_au: jusquAu }, { headers: SANS_CACHE });
}
