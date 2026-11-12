import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";
import { POIDS_MAX, preparerPhoto } from "@/lib/photo-envoi";
import { rafraichirCaches } from "@/lib/tablette";

// Photo d'un plat envoyée depuis le back-office (gérant seulement) : contrôlée, redimensionnée et
// réenregistrée par le serveur (src/lib/photo-envoi.ts), puis stockée en base et posée sur le plat.
// Corps : formulaire « slug » + « fichier », ou JSON { action: "retirer", slug }.

const SLUG = /^[a-z0-9-]{1,80}$/;
// Marge pour l'enveloppe du formulaire autour du fichier.
const CORPS_MAX = POIDS_MAX + 64 * 1024;

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const qui = g.personnel.id;

  if ((requete.headers.get("content-type") ?? "").startsWith("application/json")) {
    const c = await corpsJson(requete);
    if (!c || c.action !== "retirer" || typeof c.slug !== "string" || !SLUG.test(c.slug)) return refus("Requête illisible.", 400);
    if (!(await fonctionSql<boolean>("retirer_photo", { p_slug: c.slug, p_personnel: qui }))) return refus("Plat inconnu.", 404);
    rafraichirCaches("catalogue");
    return NextResponse.json({ enregistre: true });
  }

  // Poids annoncé exigé et contrôlé avant de lire le corps (un navigateur l'envoie toujours avec un formulaire).
  const annonce = Number(requete.headers.get("content-length") ?? "");
  if (!Number.isFinite(annonce) || annonce <= 0) return refus("Envoi illisible. Réessayez.", 411);
  if (annonce > CORPS_MAX) return refus("Photo trop lourde : 5 Mo au plus.", 413);
  let formulaire: FormData;
  try {
    formulaire = await requete.formData();
  } catch {
    return refus("Envoi illisible. Réessayez.", 400);
  }
  const slug = formulaire.get("slug");
  const fichier = formulaire.get("fichier");
  if (typeof slug !== "string" || !SLUG.test(slug)) return refus("Plat inconnu.", 404);
  if (!(fichier instanceof Blob)) return refus("Choisissez une photo.");
  if (fichier.size > POIDS_MAX) return refus("Photo trop lourde : 5 Mo au plus.", 413);

  const r = await preparerPhoto(new Uint8Array(await fichier.arrayBuffer()));
  if (!r.ok) return refus(r.erreur);
  let nom: string | null;
  try {
    nom = await fonctionSql<string | null>("envoyer_photo", {
      p_slug: slug,
      p_donnees: r.photo.donnees.toString("base64"),
      p_largeur: r.photo.largeur,
      p_hauteur: r.photo.hauteur,
      p_personnel: qui,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Réservé au gérant")) return refus("Réservé au gérant.", 403);
    throw e;
  }
  if (!nom) return refus("Plat inconnu.", 404);
  rafraichirCaches("catalogue");
  return NextResponse.json({ enregistre: true, photo: nom, largeur: r.photo.largeur, hauteur: r.photo.hauteur });
}
