import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite charge du WebAssembly : il reste hors du bundle serveur.
  serverExternalPackages: ["@electric-sql/pglite", "@resvg/resvg-wasm"],
  outputFileTracingExcludes: { "*": ["maquette/**", "docs/**"] },
  // Les previews sans Supabase rejouent migrations et amorçage : les fichiers SQL doivent suivre.
  outputFileTracingIncludes: {
    "/carte": ["./supabase/**/*.sql", "./node_modules/@electric-sql/pglite/dist/**"],
    // Rendu des tickets en PNG : moteur resvg (wasm) et police DejaVu, lus sur le disque à l'exécution.
    "/api/cloudprnt/[jeton]": ["./node_modules/@resvg/resvg-wasm/index_bg.wasm", "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed*.ttf"],
  },
  // Manifeste de la tablette (fichier de public/) : servi avec son vrai type.
  async headers() {
    return [{ source: "/tablette.webmanifest", headers: [{ key: "Content-Type", value: "application/manifest+json" }] }];
  },
  env: {
    // Netlify fournit CONTEXT pendant le build (production, deploy-preview, branch-deploy).
    // On le fige dans le code pour le connaître aussi à l'exécution. « local » sur ce poste.
    CONTEXTE_DEPLOIEMENT: process.env.CONTEXT ?? "local",
    // Adresse publique pour les liens absolus (méta, plan du site, Schema.org) : src/lib/site.ts.
    ADRESSE_SITE: process.env.URL_SITE ?? process.env.DEPLOY_PRIME_URL ?? "http://localhost:3000",
  },
};

export default nextConfig;
