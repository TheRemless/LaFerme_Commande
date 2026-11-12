import { fonctionSql } from "@/lib/db/serveur";
import { estPhotoEnvoyee } from "@/lib/photos";

// Photo d'un plat envoyée depuis le back-office. Le nom change à chaque envoi : le fichier ne change
// jamais, il se garde un an dans les caches (Netlify, navigateur). Une photo retirée n'est plus servie.
export async function GET(_requete: Request, { params }: { params: Promise<{ fichier: string }> }) {
  const { fichier } = await params;
  const absente = () => new Response("Photo introuvable.", { status: 404, headers: { "Cache-Control": "public, max-age=60", "Content-Type": "text/plain; charset=utf-8" } });
  if (!estPhotoEnvoyee(fichier)) return absente();
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
