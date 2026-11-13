-- Décaler les commandes en cours (vague 3, bo-operations ; P0 de produit-gestion, avec tablette). Le coup de feu
-- et le retard du soir ne touchent que les commandes à venir. Vendredi 20h, trente commandes acceptées, le four
-- prend vingt minutes de retard : leurs clients gardent une heure fausse. Un geste décale désormais toutes les
-- commandes en cours (ou celles d'un poste) de N minutes. Le serveur prévient chaque client par l'e-mail
-- « nouvelle heure », un seul par commande (src/lib/decalage.ts).
--
-- Commandes visées : acceptées ou en préparation, dont l'heure promise tombe dans les 90 prochaines minutes ou
-- est déjà passée. Les commandes pour plus tard ne bougent pas : la cuisine a le temps de rattraper. Avec un
-- poste : seulement celles qui ont des lignes à ce poste et dont ce poste n'a pas fini (commande_postes, session
-- tablette, 20261203120000 ; sans la table, toutes celles qui ont des lignes à ce poste).
--
-- Un double appui ne décale pas deux fois : chaque geste porte une clé, gardée dans decalages_commandes.
-- Aucune fonction partagée recréée. plpgsql : commande_postes peut arriver après cette migration.

create table decalages_commandes (
  cle text primary key check (char_length(cle) between 8 and 64),
  minutes smallint not null check (minutes between 5 and 90),
  station station,
  par text not null,
  -- Commandes décalées par ce geste : [{ id, avant, apres }]. Aucune donnée de client.
  commandes jsonb not null,
  cree_le timestamptz not null default now()
);
alter table decalages_commandes enable row level security;
revoke all on decalages_commandes from anon, authenticated;
grant select, insert on decalages_commandes to service_role;

-- Commandes que le geste toucherait maintenant (identifiants).
create function commandes_a_decaler(p_station station) returns setof uuid
language plpgsql stable as $$
declare
  postes boolean := to_regclass('public.commande_postes') is not null;
begin
  if p_station is null then
    return query
      select c.id from commandes c
      where c.statut in ('acceptee', 'en_preparation')
        and c.heure_confirmee is not null
        and c.heure_confirmee <= now() + interval '90 minutes';
  elsif postes then
    return query execute
      'select c.id from commandes c
       where c.statut in (''acceptee'', ''en_preparation'')
         and c.heure_confirmee is not null
         and c.heure_confirmee <= now() + interval ''90 minutes''
         and exists (select 1 from commande_lignes l where l.commande_id = c.id and l.station = $1)
         and not exists (select 1 from commande_postes p where p.commande_id = c.id and p.station = $1 and p.pret_le is not null)'
      using p_station;
  else
    return query
      select c.id from commandes c
      where c.statut in ('acceptee', 'en_preparation')
        and c.heure_confirmee is not null
        and c.heure_confirmee <= now() + interval '90 minutes'
        and exists (select 1 from commande_lignes l where l.commande_id = c.id and l.station = p_station);
  end if;
end;
$$;

-- Aperçu pour la confirmation : commandes touchées et clients prévenus (une adresse e-mail par commande).
create function apercu_decalage(p_station station) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'commandes', count(*),
    'clients', count(*) filter (where c.client_email is not null and c.client_email <> '')
  )
  from commandes c where c.id in (select commandes_a_decaler(p_station));
$$;

-- Le geste. Rend { deja, minutes, commandes: [{ id, avant, apres }] }. Même clé : rend le premier résultat, sans
-- rien décaler de plus (deja = vrai). Équipe du restaurant seulement (equipe_nom, revérifié ici).
create function decaler_commandes(p_minutes integer, p_station station, p_cle text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := equipe_nom(p_personnel);
  existant decalages_commandes%rowtype;
  liste jsonb;
begin
  if p_minutes is null or p_minutes not between 5 and 90 then
    raise exception 'Décalage : de 5 à 90 minutes';
  end if;
  if p_cle is null or char_length(p_cle) not between 8 and 64 then
    raise exception 'Clé du geste illisible';
  end if;
  perform pg_advisory_xact_lock(hashtext('decaler_commandes'));
  select * into existant from decalages_commandes where cle = p_cle;
  if found then
    return jsonb_build_object('deja', true, 'minutes', existant.minutes, 'commandes', existant.commandes);
  end if;

  with visees as (
    select c.id, c.statut, c.heure_confirmee as avant
    from commandes c
    where c.id in (select commandes_a_decaler(p_station))
    for update
  ),
  maj as (
    update commandes c set heure_confirmee = v.avant + make_interval(mins => p_minutes)
    from visees v where c.id = v.id
    returning c.id, v.statut, v.avant, c.heure_confirmee as apres
  ),
  ev as (
    insert into evenements_commande (commande_id, de, vers, par, detail)
    select m.id, m.statut, m.statut, 'tablette:' || qui, 'heure ' || m.apres::text || ' (décalage +' || p_minutes || ' min)' from maj m
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'avant', m.avant, 'apres', m.apres) order by m.avant), '[]'::jsonb)
    into liste from maj m;

  insert into decalages_commandes (cle, minutes, station, par, commandes) values (p_cle, p_minutes, p_station, qui, liste);
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'decalage', coalesce(p_station::text, 'tous'), null,
      jsonb_build_object('minutes', p_minutes, 'commandes', jsonb_array_length(liste)));
  return jsonb_build_object('deja', false, 'minutes', p_minutes, 'commandes', liste);
end;
$$;

revoke execute on function commandes_a_decaler(station), apercu_decalage(station), decaler_commandes(integer, station, text, uuid)
  from public, anon, authenticated;
grant execute on function commandes_a_decaler(station), apercu_decalage(station), decaler_commandes(integer, station, text, uuid)
  to service_role;
