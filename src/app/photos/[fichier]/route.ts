import { fonctionSql } from "@/lib/db/serveur";
import { estPhotoEnvoyee } from "@/lib/photos";

// Photo d'un plat envoyée depuis le back-office. Le nom change à chaque envoi : le fichier ne change
// jamais, il se garde un an dans les caches (Netlify, navigateur). Une photo retirée n'est plus servie.
// Une adresse avec paramètres (?x=1, ?x=2…) aurait chacune sa place dans le cache du CDN et relirait la photo
// en base à chaque fois : refusée sans lire la base (audit de sécurité 2, S2-11).
export async function GET(requete: Request, { params }: { params: Promise<{ fichier: string }> }) {
  const { fichier } = await params;
  const absente = () => new Response("Photo introuvable.", { status: 404, headers: { "Cache-Control": "public, max-age=60", "Content-Type": "text/plain; charset=utf-8" } });
  if (!estPhotoEnvoyee(fichier) || new URL(requete.url).search !== "") return absente();
  const base64 = await fonctionSql<string | null>("photo_plat", { p_fichier: fichier });
  if (!base64) return absente();
  return new Response(Buffer.from(base64, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
