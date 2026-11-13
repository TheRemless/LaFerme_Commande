import { readFileSync, readdirSync } from "node:fs";
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

// Versions déjà appliquées à la vraie base (migrations-appliquees.txt). `supabase db push` refuse une migration
// nouvelle plus ancienne que la dernière appliquée, et se plaint d'une version appliquée qui n'est plus dans le
// dossier (fichier renommé après coup).
const APPLIQUEES = readFileSync(path.resolve(__dirname, "migrations-appliquees.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

function problemesOrdre(fichiers: string[], appliquees: string[]): string[] {
  const problemes: string[] = [];
  const derniere = [...appliquees].sort().at(-1) ?? "";
  const faites = new Set(appliquees);
  const locales = new Set(fichiers.map((f) => f.slice(0, 14)));
  for (const f of fichiers) {
    const v = f.slice(0, 14);
    if (!faites.has(v) && v <= derniere) {
      problemes.push(`${f} : plus ancienne que ${derniere}, la dernière appliquée à la vraie base ; la renommer dans sa plage (regles.md)`);
    }
  }
  for (const v of appliquees) if (!locales.has(v)) problemes.push(`version ${v} appliquée à la vraie base mais absente du dossier (fichier renommé ?)`);
  return problemes;
}

describe("migrations", () => {
  it("toute migration pas encore appliquée est plus récente que la dernière appliquée à la vraie base", () => {
    const fichiers = readdirSync(DOSSIER).filter((f) => !f.startsWith("."));
    expect(APPLIQUEES.every((v) => /^\d{14}$/.test(v))).toBe(true);
    expect(problemesOrdre(fichiers, APPLIQUEES)).toEqual([]);
  });

  it("repère une migration nouvelle trop ancienne et une migration appliquée renommée", () => {
    const appliquees = ["20261210090000", "20261212150000"];
    expect(problemesOrdre(["20261210090000_a.sql", "20261212150000_b.sql", "20261213090000_c.sql"], appliquees)).toEqual([]);
    expect(problemesOrdre(["20261210090000_a.sql", "20261211090000_neuve.sql", "20261212150000_b.sql"], appliquees)).toEqual([
      "20261211090000_neuve.sql : plus ancienne que 20261212150000, la dernière appliquée à la vraie base ; la renommer dans sa plage (regles.md)",
    ]);
    expect(problemesOrdre(["20261210090000_a.sql", "20261214180000_b.sql"], appliquees)).toEqual([
      "version 20261212150000 appliquée à la vraie base mais absente du dossier (fichier renommé ?)",
    ]);
  });


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
