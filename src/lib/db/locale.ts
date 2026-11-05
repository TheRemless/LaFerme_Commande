import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";

// Base Postgres embarquée pour travailler sans projet Supabase : mêmes migrations, même amorçage.
// Utilisée en développement quand les variables Supabase sont absentes, et par les tests.

const SUPABASE = path.join(process.cwd(), "supabase");

export async function creerBaseLocale(): Promise<PGlite> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(await readFile(path.join(SUPABASE, "local", "roles.sql"), "utf8"));
  const migrations = (await readdir(path.join(SUPABASE, "migrations"))).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    await db.exec(await readFile(path.join(SUPABASE, "migrations", f), "utf8"));
  }
  await db.exec(await readFile(path.join(SUPABASE, "seed.sql"), "utf8"));
  return db;
}

// Gardée sur globalThis pour survivre aux rechargements à chaud de next dev.
const cache = globalThis as typeof globalThis & { baseLaFerme?: Promise<PGlite> };

export function baseLocale(): Promise<PGlite> {
  cache.baseLaFerme ??= creerBaseLocale().catch((e) => {
    // Un échec ne reste pas en cache : la requête suivante réessaie.
    cache.baseLaFerme = undefined;
    throw e;
  });
  return cache.baseLaFerme;
}

// Exécute une lecture avec le rôle d'un visiteur anonyme, pour que la sécurité par ligne s'applique.
export async function lireCommeVisiteur<T>(db: PGlite, sql: string): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    const res = await tx.query<T>(sql);
    return res.rows;
  });
}
