import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite charge du WebAssembly : il reste hors du bundle serveur.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingExcludes: { "*": ["maquette/**", "docs/**"] },
  // Les previews sans Supabase rejouent migrations et amorçage : les fichiers SQL doivent suivre.
  outputFileTracingIncludes: { "/carte": ["./supabase/**/*.sql", "./node_modules/@electric-sql/pglite/dist/**"] },
  env: {
    // Netlify fournit CONTEXT pendant le build (production, deploy-preview, branch-deploy).
    // On le fige dans le code pour le connaître aussi à l'exécution. « local » sur ce poste.
    CONTEXTE_DEPLOIEMENT: process.env.CONTEXT ?? "local",
  },
};

export default nextConfig;
