-- Commandes touchées par une rupture (vague 3, bo-carte, contrôle du 13.11.2026). Après « Épuiser » (un
-- plat, plusieurs plats, tout un poste ou une catégorie), le back-office et la tablette montrent les
-- commandes déjà passées qui contiennent ces plats et ne sont pas encore prêtes : on appelle le client
-- avant que la cuisine ne découvre le manque.
--
-- Fonction neuve, lecture seule ; aucun objet partagé recréé.

-- Commandes nouvelles, acceptées ou en préparation dont le jour de service va d'aujourd'hui à p_jusqu_au
-- (aujourd'hui seul si null) et qui contiennent un plat de p_slugs ou de la cible ('poste:pizza',
-- 'poste:cuisine', 'categorie:<slug>'). Ni nom, ni téléphone, ni adresse : le numéro et l'heure suffisent
-- pour retrouver la commande, la fiche donne le reste.
-- [{ id, numero, jour, statut, mode, heure (minutes depuis minuit, null : dès que possible), lignes: [{ nom, qte }] }]
create function commandes_touchees(p_slugs text[], p_cible text, p_jusqu_au date) returns jsonb
language sql stable as $$
  with aujourdhui as (select (now() at time zone 'Europe/Zurich')::date as d),
  touchees as (
    select l.commande_id, l.nom, l.qte, l.position
    from commande_lignes l
    where l.plat_slug = any(coalesce(p_slugs, '{}'))
       or (p_cible = 'poste:pizza' and l.station = 'pizza')
       or (p_cible = 'poste:cuisine' and l.station = 'cuisine')
       or (p_cible like 'categorie:%' and l.plat_slug in (
             select p.slug from plats p join categories c on c.id = p.categorie_id where c.slug = substr(p_cible, 11)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'numero', c.numero, 'jour', coalesce(c.quand_date, c.jour), 'statut', c.statut, 'mode', c.mode,
      'heure', c.quand_minutes,
      'lignes', (select jsonb_agg(jsonb_build_object('nom', t.nom, 'qte', t.qte) order by t.position) from touchees t where t.commande_id = c.id)
    ) order by coalesce(c.quand_date, c.jour), c.quand_minutes nulls first, c.numero), '[]'::jsonb)
  from commandes c, aujourdhui a
  where c.statut in ('nouvelle', 'acceptee', 'en_preparation')
    and coalesce(c.quand_date, c.jour) between a.d and greatest(a.d, coalesce(p_jusqu_au, a.d))
    and exists (select 1 from touchees t where t.commande_id = c.id);
$$;

revoke execute on function commandes_touchees(text[], text, date) from public, anon, authenticated;
grant execute on function commandes_touchees(text[], text, date) to service_role;
