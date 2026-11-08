import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Supabase refuse, depuis l'API, un UPDATE ou un DELETE sans WHERE (extension safeupdate). La base embarquée
// des tests ne le fait pas : on vérifie donc le texte des migrations. Seules les fonctions comptent
// (les migrations elles-mêmes tournent sans cette protection).
describe("migrations", () => {
  it("aucun UPDATE ni DELETE sans WHERE dans le corps d'une fonction", () => {
    const fautifs: string[] = [];
    const fichiers = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    // La dernière version de chaque fonction fait foi (create or replace dans une migration plus récente).
    const corps = new Map<string, { fichier: string; texte: string }>();
    for (const f of fichiers) {
      const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
      for (const m of sql.matchAll(/create (?:or replace )?function\s+(\w+)\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)) {
        corps.set(m[1], { fichier: f, texte: m[2] });
      }
    }
    for (const [nom, { fichier, texte }] of corps) {
      const sansCommentaires = texte.replace(/--[^\n]*/g, "");
      for (const instr of sansCommentaires.split(";")) {
        const t = instr.trim().replace(/\s+/g, " ");
        if (/^(with .*\) )?(update|delete from) /i.test(t) && !/ where /i.test(` ${t} `)) fautifs.push(`${fichier} ${nom} : ${t.slice(0, 80)}`);
      }
    }
    expect(fautifs).toEqual([]);
  });
});
