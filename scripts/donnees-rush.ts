// npm run donnees:rush : construit une base embarquée avec les volumes d'un vrai restaurant et l'enregistre
// dans .pglite/rush.tar.gz (hors du dépôt). Le site la charge ensuite avec BASE_LOCALE_INSTANTANE.
//
//   npm run donnees:rush                         graine fixe, « maintenant » = l'heure actuelle au quart d'heure
//   npm run donnees:rush -- --maintenant=2026-11-13T19:45 --graine=7 --echelle=0.1 --sortie=.pglite/petit.tar.gz
//
// Ne parle jamais à Supabase : refuse de tourner si une variable de connexion à une vraie base est présente.
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { creerBaseLocale } from "../src/lib/db/locale";
import { genererRush, OPTIONS_PAR_DEFAUT } from "./rush/generer";
import { empreinteRush, refusHorsBaseEmbarquee } from "./rush/garde";

function argument(nom: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${nom}=`));
  return a?.slice(nom.length + 3);
}

// « 2026-11-13T19:45 » est lu à l'heure de Genève.
function lireMaintenant(v: string | undefined): Date {
  if (!v) {
    const d = new Date();
    d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
    return d;
  }
  if (/[zZ]|[+-]\d\d:\d\d$/.test(v)) return new Date(v);
  const brut = new Date(`${v}:00Z`);
  const decalage = new Date(brut.toLocaleString("en-US", { timeZone: "Europe/Zurich" })).getTime() - new Date(brut.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(brut.getTime() - decalage);
}

async function main() {
  const refus = refusHorsBaseEmbarquee(process.env);
  if (refus) {
    console.error(refus);
    process.exit(1);
  }
  // Toujours une base neuve, migrations de la branche en cours comprises.
  delete process.env.BASE_LOCALE_INSTANTANE;

  const maintenant = lireMaintenant(argument("maintenant"));
  if (Number.isNaN(maintenant.getTime())) throw new Error("--maintenant illisible (attendu : 2026-11-13T19:45)");
  const options = {
    ...OPTIONS_PAR_DEFAUT,
    graine: Number(argument("graine") ?? OPTIONS_PAR_DEFAUT.graine),
    echelle: Number(argument("echelle") ?? OPTIONS_PAR_DEFAUT.echelle),
    maintenant,
  };
  const sortie = path.resolve(argument("sortie") ?? ".pglite/rush.tar.gz");

  const debut = Date.now();
  const db = await creerBaseLocale();
  const migree = Date.now();
  const bilan = await genererRush(db, options);
  const remplie = Date.now();
  const empreinte = await empreinteRush(db);
  await mkdir(path.dirname(sortie), { recursive: true });
  await writeFile(sortie, Buffer.from(await (await db.dumpDataDir("gzip")).arrayBuffer()));
  await db.close();
  const taille = (await stat(sortie)).size;

  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich", dateStyle: "short", timeStyle: "short" }).format(maintenant).replace(" ", "T");
  console.log(`Jeu de rush prêt en ${((Date.now() - debut) / 1000).toFixed(1)} s (base ${((migree - debut) / 1000).toFixed(1)} s, données ${((remplie - migree) / 1000).toFixed(1)} s).`);
  console.log(`  ${Object.entries(bilan).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  Empreinte du contenu : ${empreinte}`);
  console.log(`  Fichier : ${sortie} (${(taille / 1e6).toFixed(1)} Mo)`);
  console.log("");
  console.log("Lancer le site sur ces données (sans .env.local) :");
  console.log(`  BASE_LOCALE_INSTANTANE=${sortie} npm run dev -- -p <ton port>`);
  console.log(`  BASE_LOCALE=1 BASE_LOCALE_INSTANTANE=${sortie} npm run build && BASE_LOCALE=1 BASE_LOCALE_INSTANTANE=${sortie} npm start -- -p <ton port>`);
  console.log("Rejouer à l'identique :");
  console.log(`  npm run donnees:rush -- --maintenant=${local} --graine=${options.graine}${options.echelle !== 1 ? ` --echelle=${options.echelle}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
