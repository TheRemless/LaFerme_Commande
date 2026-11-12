import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { creerBaseLocale } from "@/lib/db/locale";

// Une seule base migrée par passage de Vitest : chaque fichier de test en recharge une copie (0,2 s)
// au lieu de rejouer toutes les migrations (1 s seul, plus de 10 s quand quinze fichiers le font en même temps).
// Refaite à chaque passage : une migration ajoutée est toujours prise en compte.
export default async function preparerBase() {
  delete process.env.BASE_LOCALE_INSTANTANE;
  const dossier = await mkdtemp(path.join(tmpdir(), "laferme-base-"));
  const fichier = path.join(dossier, "base.tar");
  const db = await creerBaseLocale();
  await writeFile(fichier, Buffer.from(await (await db.dumpDataDir("none")).arrayBuffer()));
  await db.close();
  process.env.BASE_LOCALE_INSTANTANE = fichier;
  return async () => {
    await rm(dossier, { recursive: true, force: true });
  };
}
