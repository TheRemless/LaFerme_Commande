import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { signalerManque, type ElementManque } from "@/lib/commandes";
import { exigerPersonnel } from "@/lib/personnel/session";

// Un plat ou un supplément manque sur une commande acceptée (audit du gérant, G07). La tablette envoie les
// lignes concernées ; la base calcule le montant. confirmer = false : estimation seulement, rien n'est écrit.
// { commande, elements: [{ ligne, qte } | { ligne, groupe, nom }], cle, confirmer }
function elementsValides(v: unknown): ElementManque[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) return null;
  const sortie: ElementManque[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") return null;
    const x = e as Record<string, unknown>;
    if (!Number.isInteger(x.ligne) || (x.ligne as number) < 0 || (x.ligne as number) > 29) return null;
    if (x.groupe === undefined || x.groupe === null) {
      if (!Number.isInteger(x.qte) || (x.qte as number) < 1 || (x.qte as number) > 20) return null;
      sortie.push({ ligne: x.ligne as number, qte: x.qte as number });
    } else {
      if (typeof x.groupe !== "string" || !/^[a-z0-9-]{1,80}$/.test(x.groupe) || typeof x.nom !== "string" || x.nom.length < 1 || x.nom.length > 80) return null;
      sortie.push({ ligne: x.ligne as number, groupe: x.groupe, nom: x.nom });
    }
  }
  return sortie;
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c || typeof c.commande !== "string" || !/^[0-9a-f-]{36}$/.test(c.commande)) return refus("Commande inconnue.", 404);
  const elements = elementsValides(c.elements);
  if (!elements) return refus("Choisissez ce qui manque.");
  if (typeof c.cle !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(c.cle)) return refus("Rechargez la page puis recommencez.");
  const r = await signalerManque(c.commande, elements, c.cle, g.personnel.id, c.confirmer === true);
  return NextResponse.json(r, { status: r.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } });
}
