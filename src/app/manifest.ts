import type { MetadataRoute } from "next";

// Ajout à l'écran d'accueil du téléphone (PWA). Pas de service worker : une commande se passe en
// ligne, rien n'est servi hors connexion. La tablette a son propre manifeste (public/tablette.webmanifest).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "La Ferme, livraison et à emporter",
    short_name: "La Ferme",
    lang: "fr-CH",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f4f2",
    theme_color: "#f4f4f2",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icone-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
