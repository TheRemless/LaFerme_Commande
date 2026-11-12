import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tests e2e sur un port à soi (PORT_E2E) : build et cache à part, pour que deux instances lancées du même
  // dossier en même temps ne s'écrasent pas. Sans la variable (Netlify, dev), le dossier habituel .next.
  distDir: process.env.PORT_E2E ? `.next-e2e-${process.env.PORT_E2E}` : ".next",
  // PGlite charge du WebAssembly : il reste hors du bundle serveur.
  serverExternalPackages: ["@electric-sql/pglite", "@resvg/resvg-wasm"],
  outputFileTracingExcludes: { "*": ["maquette/**", "docs/**"] },
  // Les previews sans Supabase rejouent migrations et amorçage : les fichiers SQL doivent suivre.
  outputFileTracingIncludes: {
    "/carte": ["./supabase/**/*.sql", "./node_modules/@electric-sql/pglite/dist/**"],
    // Rendu des tickets en PNG : moteur resvg (wasm) et police DejaVu, lus sur le disque à l'exécution.
    "/api/cloudprnt/[jeton]": ["./node_modules/@resvg/resvg-wasm/index_bg.wasm", "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed*.ttf"],
  },
  // Manifeste de la tablette servi avec son vrai type par next start (sur Netlify : netlify.toml).
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/tablette.webmanifest", headers: [{ key: "Content-Type", value: "application/manifest+json" }] },
      // Aucune page ne s'affiche dans le cadre d'un autre site ; le chemin (jeton de suivi) ne part pas ailleurs.
      {
        source: "/:chemin*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  env: {
    // Netlify fournit CONTEXT pendant le build (production, deploy-preview, branch-deploy).
    // On le fige dans le code pour le connaître aussi à l'exécution. « local » sur ce poste.
    CONTEXTE_DEPLOIEMENT: process.env.CONTEXT ?? "local",
    // Adresse publique pour les liens absolus (méta, plan du site, Schema.org) : src/lib/site.ts.
    ADRESSE_SITE: process.env.URL_SITE ?? process.env.DEPLOY_PRIME_URL ?? "http://localhost:3000",
    // Commit publié (Netlify fournit COMMIT_REF au build) : affiché par /api/sante pour reconnaître une version.
    VERSION_SITE: process.env.COMMIT_REF?.slice(0, 7) ?? "",
  },
};

export default nextConfig;
