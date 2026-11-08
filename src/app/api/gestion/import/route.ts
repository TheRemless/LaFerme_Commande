import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { lireTableau, type CarteActuelle } from "@/lib/gestion-import";
import { exigerGerant } from "@/lib/personnel/session";
import { rafraichirCaches } from "@/lib/tablette";

const TAILLE_MAX = 2 * 1024 * 1024;

// Import de docs/validation-carte.xlsx. Sans « appliquer », renvoie l'aperçu (avant, après) sans rien écrire.
// Avec « appliquer=1 », relit le même fichier et applique tout d'un bloc, journalisé.
export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  let form: FormData;
  try {
    form = await requete.formData();
  } catch {
    return refus("Envoyez le fichier .xlsx.", 400);
  }
  const fichier = form.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return refus("Choisissez le fichier validation-carte.xlsx.");
  if (fichier.size > TAILLE_MAX) return refus("Fichier trop lourd (2 Mo au plus).");
  const octets = await fichier.arrayBuffer();
  // Un .xlsx est une archive zip : elle commence par « PK ».
  const debut = new Uint8Array(octets.slice(0, 2));
  if (debut[0] !== 0x50 || debut[1] !== 0x4b) return refus("Ce n'est pas un fichier Excel (.xlsx).");

  const actuelle = await fonctionSql<CarteActuelle>("gestion_carte", {});
  let apercu;
  try {
    apercu = await lireTableau(octets, actuelle);
  } catch (e) {
    return refus(e instanceof Error && e.message.length < 200 ? e.message : "Fichier illisible.");
  }
  if (form.get("appliquer") !== "1") return NextResponse.json({ lignes: apercu.lignes, avertissements: apercu.avertissements });
  if (apercu.plats.length === 0 && apercu.options.length === 0) return refus("Rien à appliquer : le tableau correspond déjà à la carte.");
  const r = await fonctionSql<{ plats: number; options: number; bloquants: number }>("importer_validation", {
    p: { plats: apercu.plats, options: apercu.options },
    p_personnel: g.personnel.id,
  });
  rafraichirCaches("catalogue");
  return NextResponse.json({ applique: r });
}
