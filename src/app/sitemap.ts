import type { MetadataRoute } from "next";
import { pageLegalePubliable } from "@/lib/legal/acces";
import { CGV } from "@/lib/legal/cgv";
import { CONFIDENTIALITE } from "@/lib/legal/confidentialite";
import { MENTIONS } from "@/lib/legal/mentions";
import { ADRESSE_SITE, INDEXABLE } from "@/lib/site";

// Plan du site : seulement les pages publiques, et les pages légales une fois publiées.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!INDEXABLE) return [];
  const legales = (
    [
      [MENTIONS, "/mentions-legales"],
      [CGV, "/cgv"],
      [CONFIDENTIALITE, "/confidentialite"],
    ] as const
  )
    .filter(([page]) => pageLegalePubliable(page))
    .map(([, chemin]) => ({ url: `${ADRESSE_SITE}${chemin}` }));
  return [{ url: `${ADRESSE_SITE}/` }, { url: `${ADRESSE_SITE}/carte` }, ...legales];
}
