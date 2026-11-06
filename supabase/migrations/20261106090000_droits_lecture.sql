-- Droits de lecture explicites : les projets Supabase récents ne les donnent plus d'office
-- sur les nouvelles tables. La vue carte_publique (security_invoker) en a besoin.
-- La sécurité par ligne reste le seul filtre sur ce que voit un visiteur.
grant usage on schema public to anon, authenticated;
grant select on categories, plats, groupes_options, options, plat_groupes, plat_retraits to anon, authenticated;
grant select on carte_publique to anon, authenticated;
revoke all on plats_bloquants from anon, authenticated;
