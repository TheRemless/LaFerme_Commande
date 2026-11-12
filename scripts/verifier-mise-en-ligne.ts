// Lancé avant chaque build. Sur Netlify en production, refuse le build tant que :
// - un plat commandable a un prix, une provenance, un allergène ou un supplément non validé (docs/PROMPT.md §5) ;
// - la configuration de production est incomplète (URL_SITE, SECRET_COMPTES, pas de BASE_DE_TEST) ;
// - il reste des données de test : personnel en .test, imprimantes de test, commandes des préversions
//   (docs/audits/securite.md, S3 et S6).
import { createClient } from "@supabase/supabase-js";
import { problemesConfiguration, problemesDonnees } from "../src/lib/mise-en-ligne";

function bloquer(problemes: string[]): never {
  console.error("Mise en production bloquée :");
  for (const p of problemes) console.error(`  ${p}`);
  process.exit(1);
}

async function main() {
  if (process.env.CONTEXT !== "production") {
    console.log("Vérification de mise en ligne ignorée : ce n'est pas un build de production.");
    return;
  }
  const config = problemesConfiguration(process.env);
  if (config.length) bloquer(config);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const [plats, personnel, imprimantes, commandes] = await Promise.all([
    supabase.from("plats_bloquants").select("motif"),
    supabase.from("personnel").select("email").like("email", "%.test"),
    supabase.from("imprimantes").select("nom").or("nom.ilike.*test*,nom.ilike.*préversion*,nom.ilike.*preversion*"),
    supabase.from("commandes").select("id", { count: "exact", head: true }).neq("origine", process.env.URL_SITE!),
  ]);
  for (const [nom, r] of [["plats_bloquants", plats], ["personnel", personnel], ["imprimantes", imprimantes], ["commandes", commandes]] as const) {
    if (r.error) throw new Error(`Lecture de ${nom} impossible : ${r.error.message}`);
  }
  const donnees = problemesDonnees({
    platsBloquants: plats.data ?? [],
    personnelTest: (personnel.data ?? []).map((x) => x.email),
    imprimantesTest: (imprimantes.data ?? []).map((x) => x.nom),
    commandesEtrangeres: commandes.count ?? 0,
  });
  if (donnees.length) bloquer(donnees);
  console.log("Aucun blocage : la mise en production peut continuer.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
