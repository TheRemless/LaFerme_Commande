-- Livreurs homonymes (vague 3, bo-operations ; P2 de produit-gestion) : deux livreurs nommés « Nora » ne se
-- distinguaient pas dans la liste « Ajouter un livreur… ». Liste des livreurs (actifs ou non, pour les
-- statistiques) avec leur e-mail, d'où le serveur tire un nom distinct (src/lib/livreurs-noms.ts).
-- Gérant seulement (route /api/gestion/livreurs). Aucune fonction partagée recréée.

create function noms_livreurs() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nom', p.nom, 'email', p.email) order by p.nom), '[]'::jsonb)
  from personnel p where p.role = 'livreur';
$$;

revoke execute on function noms_livreurs() from public, anon, authenticated;
grant execute on function noms_livreurs() to service_role;
