import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite charge du WebAssembly : il reste hors du bundle serveur.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingExcludes: { "*": ["maquette/**", "docs/**"] },
};

export default nextConfig;
