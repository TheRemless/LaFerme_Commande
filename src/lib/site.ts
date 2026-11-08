import type { Metadata } from "next";

// Adresse publique du site, figée au build (next.config.ts) : URL_SITE en production, l'adresse de la
// préversion sur Netlify, localhost ici. Sert aux liens absolus des méta, du plan du site et du Schema.org.
export const ADRESSE_SITE = process.env.ADRESSE_SITE ?? "http://localhost:3000";

// Seule la production se laisse indexer. Les préversions et ce poste restent hors des moteurs.
export const INDEXABLE = process.env.CONTEXTE_DEPLOIEMENT === "production";

// Pages propres à un client ou à l'équipe : jamais dans un moteur de recherche.
export const PRIVE: Metadata["robots"] = { index: false, follow: false };

// Open Graph commun : Next remplace le bloc entier d'une page à l'autre, chaque page le reprend.
export const OPEN_GRAPH = {
  type: "website",
  locale: "fr_CH",
  siteName: "La Ferme",
} as const;

// Textes relus avec redaction-fr (lot 8e), faits du registre seulement.
export const DESCRIPTION_SITE =
  "Les pizzas au feu de bois et la carte de La Ferme, livrées par nos livreurs ou à emporter Route de Chancy 132 à Onex. Paiement par TWINT ou carte.";
export const DESCRIPTION_CARTE =
  "La carte de La Ferme à commander en ligne. Sur chaque pizza, on ajoute ou on retire des ingrédients.";
