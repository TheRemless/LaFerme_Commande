import { NextResponse } from "next/server";
import { champsCode } from "@/lib/codes-promo";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

// Codes promo au back-office (gérant). Chaque fonction SQL revérifie le gérant et journalise.
// Construits désactivés : rien ne s'applique au client tant que l'interrupteur général est faux.

const ERREURS: Record<string, string> = {
  code_existe: "Ce code existe déjà.",
  code_deja_utilise: "Ce code a déjà servi : son type et sa valeur ne changent plus. Créez-en un autre.",
  codes_promo_code_check: "Code : 3 à 20 lettres, chiffres ou tirets.",
  "Réservé au gérant": "Réservé au gérant.",
};

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json(await fonctionSql("codes_gestion", {}), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const qui = g.personnel.id;
  try {
    switch (c.action) {
      case "creer": {
        const champs = champsCode(c.champs, true);
        if (!champs.ok) return refus(champs.erreur);
        const code = await fonctionSql<string>("creer_code", { p: champs.valeur, p_personnel: qui });
        return NextResponse.json({ enregistre: true, code });
      }
      case "modifier": {
        if (typeof c.code !== "string" || !/^[A-Z0-9-]{3,20}$/.test(c.code)) return refus("Code inconnu.", 404);
        const champs = champsCode(c.champs, false);
        if (!champs.ok) return refus(champs.erreur);
        if (!(await fonctionSql<boolean>("modifier_code", { p_code: c.code, p: champs.valeur, p_personnel: qui }))) return refus("Code inconnu.", 404);
        break;
      }
      case "interrupteur": {
        if (typeof c.actif !== "boolean") return refus("Requête illisible.", 400);
        await fonctionSql<boolean>("activer_codes_promo", { p_actif: c.actif, p_personnel: qui });
        break;
      }
      default:
        return refus("Action inconnue.");
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const cle = Object.keys(ERREURS).find((k) => m.includes(k));
    if (cle) return refus(ERREURS[cle]);
    throw e;
  }
  // Le réglage des codes est lu avec la carte (champ « Code » au panier) : vidé comme un changement de prix.
  rafraichirCaches("catalogue");
  return NextResponse.json({ enregistre: true });
}
