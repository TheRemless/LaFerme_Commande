// Lancé avant chaque build. Sur Vercel en production, refuse le build tant qu'un plat commandable
// a un prix, une provenance, un allergène ou un supplément non validé (docs/PROMPT.md §5).
import { createClient } from "@supabase/supabase-js";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("Vérification de mise en ligne ignorée : ce n'est pas un build de production.");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) {
    throw new Error("Build de production sans NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase = createClient(url, cle, { auth: { persistSession: false } });
  const { data, error } = await supabase.from("plats_bloquants").select("slug, nom, motif");
  if (error) throw new Error(`Lecture de plats_bloquants impossible : ${error.message}`);
  if (data.length > 0) {
    const resume = new Map<string, number>();
    for (const l of data) resume.set(l.motif, (resume.get(l.motif) ?? 0) + 1);
    console.error("Mise en production bloquée :");
    for (const [motif, n] of resume) console.error(`  ${n} × ${motif}`);
    process.exit(1);
  }
  console.log("Aucun plat bloquant : la mise en production peut continuer.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
