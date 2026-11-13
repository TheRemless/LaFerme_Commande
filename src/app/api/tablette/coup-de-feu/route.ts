import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { etatCoupDeFeu, finCoupDeFeuEchue, finirCoupDeFeu, lancerCoupDeFeu } from "@/lib/coup-de-feu";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerPersonnel, type Personnel } from "@/lib/personnel/session";

// Coup de feu depuis la tablette (vague 3) : mêmes fonctions que le back-office (src/lib/coup-de-feu.ts, bo-operations).
// Le gérant peut toujours. L'équipe de service seulement si le réglage coup_de_feu_par_equipe est vrai : construit
// désactivé, la décision revient à Jérémy. Le réglage est relu à chaque requête (pas de cache) : le couper agit tout
// de suite. GET : état et `autorise`. POST { action: "lancer", ...réglages } ou { action: "finir" }.
const SANS_CACHE = { "Cache-Control": "no-store, private" };

async function autorise(p: Personnel): Promise<boolean> {
  if (p.role === "gerant") return true;
  // Responsable de service au rôle ouvert (D1) : toujours, comme le chef d'équipe d'un soir. Rôle éteint : il
  // reste dans l'équipe, avec la même règle qu'elle.
  if (p.role === "responsable" && (await fonctionSql<boolean>("role_responsable_actif", {}))) return true;
  if (p.role !== "service" && p.role !== "responsable") return false;
  const reglages = await lirePublic<{ cle: string; valeur: unknown }>("reglages");
  return reglages.find((r) => r.cle === "coup_de_feu_par_equipe")?.valeur === true;
}

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  // Heure de fin passée sans tour de surveillance : fini ici, la tablette ne montre jamais un coup de feu échu.
  await finCoupDeFeuEchue();
  const [etat, ok] = await Promise.all([etatCoupDeFeu(), autorise(g.personnel)]);
  return NextResponse.json({ ...etat, autorise: ok }, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  if (!(await autorise(g.personnel))) return refus("Le coup de feu se lance par le gérant, sur la tablette ou au back-office.", 403);
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  if (c.action === "lancer") {
    const r = await lancerCoupDeFeu(g.personnel, c);
    if (!r.ok) return refus(r.erreur);
    return NextResponse.json({ enregistre: true, ...r.etat, autorise: true }, { headers: SANS_CACHE });
  }
  if (c.action === "finir") {
    const r = await finirCoupDeFeu(g.personnel);
    // Déjà fini (autre appareil, fin automatique) : pas une erreur, l'état dit ce qu'il en est.
    return NextResponse.json({ enregistre: r.ok, deja: !r.ok, ...r.etat, autorise: true }, { headers: SANS_CACHE });
  }
  return refus("Action inconnue.");
}
