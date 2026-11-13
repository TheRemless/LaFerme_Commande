// Envoi de plusieurs photos d'un coup (back-office) : trouver le plat d'après le nom du fichier.
import { slugDe } from "@/lib/gestion";

// Le plat dont le nom ou le slug correspond le mieux au nom du fichier, ou "" si aucun.
export function platDuFichier(nomFichier: string, plats: { slug: string; nom: string }[]): string {
  const cle = slugDe(nomFichier.replace(/\.[a-z0-9]+$/i, ""), 80);
  if (!cle) return "";
  const exact = plats.find((p) => p.slug === cle || slugDe(p.nom, 80) === cle);
  if (exact) return exact.slug;
  // Nom du fichier qui contient tout le nom d'un plat (« photo-pizza-tonno-2 ») : le plus long gagne.
  const contenus = plats.filter((p) => cle.includes(p.slug)).sort((a, b) => b.slug.length - a.slug.length);
  return contenus[0]?.slug ?? "";
}
