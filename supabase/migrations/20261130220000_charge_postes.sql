-- Heure promise réaliste, version 3 (vague 3, bo-operations) : un poste qui a fini sa part ne compte plus.
-- La version 1 (20261130100000) comptait dans la file d'un poste tous les articles d'une commande pas encore
-- prête. Une commande pizza et lasagne dont les pizzas sont sorties restait dans la file du four jusqu'à ce que
-- la lasagne soit prête : le four paraissait chargé, les heures s'allongeaient à tort.
--
-- Désormais, si la table commande_postes (session tablette, 20261203120000) dit qu'un poste a fini sa part
-- (pret_le rempli), les articles de ce poste ne comptent plus dans sa file. Le reste de la règle ne change pas.
--
-- Objet recréé : charge_cuisine() (la mienne, 20261130100000), même signature et même réponse. Passée en plpgsql
-- pour fonctionner avant et après la migration de tablette, quel que soit l'ordre de fusion : sans la table,
-- le calcul reste celui de la version 1. La partie ajoutée n'a aucune donnée d'utilisateur (requête fixe).

create or replace function charge_cuisine() returns jsonb
language plpgsql stable as $$
declare
  -- Articles d'un poste déjà prêts : retirés de sa file (version 3), si la table existe.
  postes_prets text := case when to_regclass('public.commande_postes') is not null then
    'and not exists (select 1 from commande_postes p where p.commande_id = d.id and p.station = l.station and p.pret_le is not null)'
    else '' end;
  r jsonb;
begin
  execute format($q$
  with r as (
    select
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'preparation_minutes'), 20) as prep,
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'allongement_max_minutes'), 0) as plafond,
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'debit_pizza_quart_heure'), 0) as debit_pizza,
      coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'debit_cuisine_quart_heure'), 0) as debit_cuisine
  ),
  dues as (
    select c.id, coalesce(
      c.heure_confirmee,
      case when c.quand_type = 'creneau' then (c.quand_date + make_interval(mins => c.quand_minutes)) at time zone 'Europe/Zurich' end,
      now()
    ) as due
    from commandes c
    where c.statut in ('nouvelle', 'acceptee', 'en_preparation')
  ),
  articles as (
    select l.station, sum(l.qte)::integer as n
    from dues d
    join commande_lignes l on l.commande_id = d.id
    cross join r
    where d.due <= now() + make_interval(mins => r.prep + r.plafond)
      and d.due > now() - make_interval(mins => greatest(r.plafond, 15))
      %s
    group by l.station
  ),
  postes as (
    select
      coalesce((select n from articles where station = 'pizza'), 0) as pizzas,
      coalesce((select n from articles where station = 'cuisine'), 0) as plats,
      r.*
    from r
  ),
  files as (
    select p.*,
      case when p.debit_pizza > 0 then ceil(p.pizzas * 15.0 / p.debit_pizza)::integer else 0 end as file_pizza,
      case when p.debit_cuisine > 0 then ceil(p.plats * 15.0 / p.debit_cuisine)::integer else 0 end as file_cuisine
    from postes p
  )
  select jsonb_build_object(
    'pizza', jsonb_build_object('articles', f.pizzas, 'file_minutes', f.file_pizza, 'compte', f.debit_pizza > 0),
    'cuisine', jsonb_build_object('articles', f.plats, 'file_minutes', f.file_cuisine, 'compte', f.debit_cuisine > 0),
    'preparation_minutes', f.prep,
    'plafond_minutes', f.plafond,
    'allongement_minutes', least(
      f.plafond,
      (ceil(greatest(0, greatest(f.file_pizza, f.file_cuisine) - f.prep) / 5.0) * 5)::integer
    )
  )
  from files f
  $q$, postes_prets) into r;
  return r;
end;
$$;

revoke execute on function charge_cuisine() from public, anon, authenticated;
grant execute on function charge_cuisine() to service_role;
