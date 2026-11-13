import type { PGlite } from "@electric-sql/pglite";

// Le jeu de rush ne s'écrit que dans une base embarquée. Une variable qui mène à une vraie base
// (Supabase, Postgres, Netlify) suffit à refuser : mieux vaut un refus de trop qu'une commande factice en production.
const VARIABLES_INTERDITES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL_SAUVEGARDE",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "PGHOST",
  "NETLIFY",
  "CONTEXT",
];

export function refusHorsBaseEmbarquee(env: Record<string, string | undefined>): string | null {
  const trouvees = VARIABLES_INTERDITES.filter((v) => env[v]);
  if (env.CONTEXTE_DEPLOIEMENT && env.CONTEXTE_DEPLOIEMENT !== "local") trouvees.push("CONTEXTE_DEPLOIEMENT");
  if (!trouvees.length) return null;
  return `Jeu de rush refusé : ${trouvees.join(", ")} présente(s). Il ne s'écrit que dans la base embarquée ; relancer sans ces variables.`;
}

// Empreinte du contenu généré (pas du fichier, qui change d'un passage à l'autre) : même graine et même
// instant donnent la même empreinte.
export async function empreinteRush(db: PGlite): Promise<string> {
  const r = await db.query<{ e: string }>(`
    select md5(
      (select coalesce(string_agg(md5(row(c.id, c.numero, c.jour_service, c.statut, c.statut_paiement, c.total_centimes, c.cree_le, c.client_email)::text), '' order by c.id), '') from commandes c)
      || (select coalesce(string_agg(md5(row(l.id, l.commande_id, l.plat_slug, l.qte, l.total_centimes, l.choix)::text), '' order by l.id), '') from commande_lignes l)
      || (select coalesce(string_agg(md5(row(r.id, r.montant_centimes, r.statut)::text), '' order by r.id), '') from remboursements r)
      || (select count(*)::text from evenements_commande) || (select count(*)::text from livraisons) || (select count(*)::text from journal_gestion)
    ) as e`);
  return r.rows[0].e;
}
