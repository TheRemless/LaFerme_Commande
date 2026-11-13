-- Heure promise réaliste, version 1 (vague 3, bo-operations). Le site annonçait un délai fixe (préparation
-- ou délai de la zone, plus le retard posé à la main). Un vendredi soir, le four a 22 pizzas en file et la
-- commande arrive 40 minutes après l'heure annoncée. Désormais la file réelle de chaque poste allonge les
-- heures annoncées partout où le délai est lu (accueil, créneaux, paiement, tablette à l'acceptation).
--
-- Règle : file d'un poste = articles à faire avant une commande passée maintenant, divisés par le débit du
-- poste (articles par quart d'heure). Allongement = ce que la plus longue file dépasse du délai de
-- préparation habituel, arrondi aux 5 minutes, plafonné. Jamais plus tôt que le délai fixe d'aujourd'hui.
--
-- Pas de fonction partagée recréée. Les débits valent 0 tant que Jérémy n'a pas donné les vrais chiffres
-- (question D8) : la file n'est alors pas comptée et rien ne change pour les clients.

insert into reglages (cle, valeur, proposition) values
  -- Articles qu'un poste sort en 15 minutes. 0 : poste non compté.
  ('debit_pizza_quart_heure', '0', true),
  ('debit_cuisine_quart_heure', '0', true),
  -- Allongement au plus, en minutes, par-dessus le délai fixe et le retard posé à la main.
  ('allongement_max_minutes', '45', true),
  -- Largeur de la fourchette annoncée au client (« de 19h40 à 19h55 »), par mode.
  ('fourchette_livraison_minutes', '15', true),
  ('fourchette_retrait_minutes', '10', true)
  on conflict (cle) do nothing;

-- Commandes en cuisine : lue à chaque calcul de file (une fois par minute au plus, config en cache).
create index commandes_en_cuisine_idx on commandes (heure_confirmee)
  where statut in ('nouvelle', 'acceptee', 'en_preparation');

-- File de chaque poste à l'instant. Comptent les articles des commandes pas encore prêtes (nouvelles,
-- acceptées, en préparation) dues avant qu'une commande passée maintenant soit prête au plus tard
-- (préparation habituelle plus l'allongement maximal), et pas en retard de plus que l'allongement maximal
-- (une commande oubliée sur la tablette ne gonfle pas la file). Aucune donnée de client.
create function charge_cuisine() returns jsonb
language sql stable as $$
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
  from files f;
$$;

revoke execute on function charge_cuisine() from public, anon, authenticated;
grant execute on function charge_cuisine() to service_role;
