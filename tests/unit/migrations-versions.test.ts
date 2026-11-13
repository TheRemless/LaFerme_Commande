import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Supabase range les migrations par leur version (les 14 chiffres du début du nom). Deux fichiers avec la
// même version : `supabase db push` n'en applique qu'un, ou refuse, et la base embarquée les rejoue dans un
// ordre qui ne sera pas celui de la vraie base. Un renommage pendant un rebase suffit à le provoquer.
const DOSSIER = path.resolve(__dirname, "../../supabase/migrations");

function problemesMigrations(fichiers: string[]): string[] {
  const problemes: string[] = [];
  const parVersion = new Map<string, string[]>();
  for (const f of fichiers) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(f)) {
      problemes.push(`${f} : nom attendu « AAAAMMJJhhmmss_nom.sql » (minuscules, chiffres, _)`);
      continue;
    }
    const v = f.slice(0, 14);
    parVersion.set(v, [...(parVersion.get(v) ?? []), f]);
  }
  for (const [v, liste] of parVersion) if (liste.length > 1) problemes.push(`version ${v} en double : ${liste.join(", ")}`);
  return problemes;
}

describe("migrations", () => {
  it("chaque fichier de supabase/migrations a sa propre version", () => {
    const fichiers = readdirSync(DOSSIER).filter((f) => !f.startsWith("."));
    expect(fichiers.length).toBeGreaterThan(0);
    expect(problemesMigrations(fichiers)).toEqual([]);
  });

  it("repère une version en double et un nom mal formé", () => {
    expect(problemesMigrations(["20261204090000_a.sql", "20261204090000_b.sql", "20261204100000_c.sql"])).toEqual([
      "version 20261204090000 en double : 20261204090000_a.sql, 20261204090000_b.sql",
    ]);
    expect(problemesMigrations(["2026120409000_court.sql", "20261204090000_Majuscule.sql", "20261204090000_notes.md"])).toHaveLength(3);
  });
});
