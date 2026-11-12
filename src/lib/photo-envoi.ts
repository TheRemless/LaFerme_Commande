import "server-only";
import sharp from "sharp";

// Photo envoyée par le gérant (téléphone ou ordinateur). Le serveur ne garde jamais le fichier reçu :
// il le décode, le tourne selon l'appareil photo, le recadre en 4:3 et le réenregistre en JPEG à la
// taille des photos du shooting (2133 × 1600). Les métadonnées (lieu GPS, appareil) disparaissent.
// next/image en tire ensuite les tailles plus petites pour chaque écran.

// Netlify refuse une requête de plus de 6 Mo ; le navigateur réduit la photo avant l'envoi.
export const POIDS_MAX = 5 * 1024 * 1024;
export const LARGEUR = 2133;
export const HAUTEUR = 1600;
// En dessous, la photo serait floue sur la fiche du plat (audit design, D02).
export const LARGEUR_MIN = 1200;
export const HAUTEUR_MIN = 900;
// Au-delà, on refuse avant de décoder (bombe de décompression).
const PIXELS_MAX = 50_000_000;

export type PhotoPrete = { donnees: Buffer; largeur: number; hauteur: number };
export type ResultatPhoto = { ok: true; photo: PhotoPrete } | { ok: false; erreur: string };

type Format = "jpeg" | "png" | "webp" | "avif";

// Type réel lu dans les premiers octets, sans croire le nom ni le type annoncés par le navigateur.
export function formatDe(o: Uint8Array): Format | null {
  const ascii = (debut: number, fin: number) => String.fromCharCode(...o.subarray(debut, fin));
  if (o.length >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return "jpeg";
  if (o.length >= 8 && o[0] === 0x89 && ascii(1, 4) === "PNG" && o[4] === 0x0d && o[5] === 0x0a && o[6] === 0x1a && o[7] === 0x0a) return "png";
  if (o.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (o.length >= 12 && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "avif";
  return null;
}

export async function preparerPhoto(octets: Uint8Array): Promise<ResultatPhoto> {
  if (octets.length === 0) return { ok: false, erreur: "Fichier vide." };
  if (octets.length > POIDS_MAX) return { ok: false, erreur: "Photo trop lourde : 5 Mo au plus." };
  const format = formatDe(octets);
  if (!format) return { ok: false, erreur: "Format non reconnu : envoyez une photo JPEG, PNG, WebP ou AVIF." };
  try {
    const image = sharp(octets, { limitInputPixels: PIXELS_MAX, failOn: "error", animated: false });
    const meta = await image.metadata();
    if (meta.format !== format && !(format === "avif" && meta.format === "heif")) {
      return { ok: false, erreur: "Le contenu du fichier ne correspond pas à son format." };
    }
    // Orientation de l'appareil appliquée : largeur et hauteur réelles de la photo affichée.
    const tournee = (meta.orientation ?? 1) >= 5;
    const l = (tournee ? meta.height : meta.width) ?? 0;
    const h = (tournee ? meta.width : meta.height) ?? 0;
    // Plus grand rectangle 4:3 tiré de la photo.
    const largeur43 = Math.min(l, Math.floor((h * 4) / 3));
    const hauteur43 = Math.round((largeur43 * 3) / 4);
    if (largeur43 < LARGEUR_MIN || hauteur43 < HAUTEUR_MIN) {
      return { ok: false, erreur: `Photo trop petite : au moins ${LARGEUR_MIN} × ${HAUTEUR_MIN} pixels, sinon elle serait floue.` };
    }
    const largeur = Math.min(LARGEUR, largeur43);
    const hauteur = Math.round((largeur * 3) / 4);
    const donnees = await image
      .rotate()
      .resize(largeur, hauteur, { fit: "cover", position: "centre" })
      // Fond d'une photo transparente (PNG détouré) : même gris clair que le jeton --papier de globals.css.
      .flatten({ background: "#f4f4f2" })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return { ok: true, photo: { donnees, largeur, hauteur } };
  } catch {
    return { ok: false, erreur: "Photo illisible. Essayez avec une autre." };
  }
}
