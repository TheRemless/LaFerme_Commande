import type { MetadataRoute } from "next";
import { ADRESSE_SITE, INDEXABLE } from "@/lib/site";

// Production : accueil, carte et pages légales ouvertes aux moteurs, le reste fermé.
// Préversions et poste local : tout fermé.
export default function robots(): MetadataRoute.Robots {
  if (!INDEXABLE) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/panier", "/commande", "/suivi/", "/compte", "/tablette", "/gestion", "/livreur", "/paiement-test/", "/dev/"],
    },
    sitemap: `${ADRESSE_SITE}/sitemap.xml`,
  };
}
