import { ADRESSE_SITE } from "@/lib/site";

// Schema.org du restaurant (lot 8e, SearchFit). Uniquement les faits du registre
// (~/.claude/skills/redaction-fr/references/faits/la-ferme.md) : nom, adresse, téléphone, carte,
// livraison par les livreurs du restaurant et retrait. Ni horaires, ni prix, ni avis tant qu'ils ne
// sont pas validés par Jérémy.
export function schemaRestaurant() {
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${ADRESSE_SITE}/#restaurant`,
    name: "Restaurant La Ferme",
    url: ADRESSE_SITE,
    image: `${ADRESSE_SITE}/opengraph-image.jpg`,
    telephone: "+41 22 792 16 89",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Route de Chancy 132",
      postalCode: "1213",
      addressLocality: "Onex",
      addressCountry: "CH",
    },
    hasMenu: `${ADRESSE_SITE}/carte`,
    potentialAction: {
      "@type": "OrderAction",
      target: { "@type": "EntryPoint", urlTemplate: ADRESSE_SITE, inLanguage: "fr-CH" },
      deliveryMethod: ["http://purl.org/goodrelations/v1#DeliveryModeOwnFleet", "http://purl.org/goodrelations/v1#DeliveryModePickUp"],
    },
  };
}

// JSON dans une balise script : « < » échappé pour qu'aucun texte ne puisse fermer la balise.
export function jsonLd(objet: unknown): string {
  return JSON.stringify(objet).replace(/</g, "\\u003c");
}
