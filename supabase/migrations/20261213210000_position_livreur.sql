-- Position du livreur en direct au suivi (vague 3, décision de Jérémy du 13.11.2026) : « seulement s'il est en
-- train de livrer sa commande. Le 2e client ne doit pas savoir où il livre au 1er client. »
--
-- Règles tenues ici, en base, quel que soit le téléphone :
-- - une position n'est gardée que pour l'arrêt EN COURS du livreur : sa première livraison dans l'ordre de la tournée
--   (même ordre que livraisons_livreur), à condition qu'elle soit partie. Avant le départ, rien n'est gardé ;
-- - une seule ligne par livreur : passer à l'arrêt suivant remplace la position, celle de l'arrêt d'avant n'existe plus ;
-- - le suivi d'une commande ne lit la position que si cette commande est l'arrêt en cours de son livreur, et seulement
--   une position de moins de 2 minutes ;
-- - livrée, client absent, annulée, retirée ou donnée à un autre livreur : la position est effacée sur-le-champ
--   (déclencheurs). Une position qui n'est plus envoyée est effacée au bout de 15 minutes.
-- - coordonnées arrondies à 4 décimales (une dizaine de mètres), sans historique ni journal ;
-- - point de masquage (relecture de qualite) : quand l'arrêt en cours suit une livraison (et non le départ du
--   restaurant), le premier point reçu pour ce nouvel arrêt est souvent pris devant la porte du client d'avant. Il est
--   gardé dans la même ligne, et le suivi ne montre rien tant que le livreur est à moins de 400 m de ce point.
--
-- Interrupteur : réglage position_livreur_en_direct (vrai, décision de Jérémy). Faux : plus rien n'est gardé ni lu.
-- Aucune fonction partagée recréée.

insert into reglages (cle, valeur, proposition) values ('position_livreur_en_direct', 'true', false)
  on conflict (cle) do nothing;

create table positions_livreur (
  livreur_id uuid primary key references personnel (id) on delete cascade,
  commande_id uuid not null references commandes (id) on delete cascade,
  lat numeric(7, 4) not null,
  lon numeric(7, 4) not null,
  precision_m integer not null,
  le timestamptz not null default now(),
  -- Premier point reçu pour cet arrêt quand il suit une livraison : rien n'est montré à moins de 400 m.
  masque_lat numeric(7, 4),
  masque_lon numeric(7, 4)
);
create index positions_livreur_commande_idx on positions_livreur (commande_id);

alter table positions_livreur enable row level security;
revoke all on positions_livreur from anon, authenticated;
grant select, insert, update, delete on positions_livreur to service_role;

-- Un arrêt vient de se terminer (livré, client absent clos, annulé, retiré) : le prochain arrêt de ce livreur commence
-- peut-être devant la porte du client d'avant. Marque lue et effacée au premier point du nouvel arrêt.
create table suites_livreur (
  livreur_id uuid primary key references personnel (id) on delete cascade,
  le timestamptz not null default now()
);
alter table suites_livreur enable row level security;
revoke all on suites_livreur from anon, authenticated;
grant select, insert, update, delete on suites_livreur to service_role;

-- Distance en mètres entre deux points proches (approximation plane, largement assez précise à Genève).
create function distance_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) returns double precision
language sql immutable as $$
  select sqrt(power((lon2 - lon1)::double precision * cos(radians(((lat1 + lat2) / 2)::double precision)) * 111320, 2)
            + power((lat2 - lat1)::double precision * 110574, 2));
$$;

create function position_livreur_active() returns boolean
language sql stable as $$
  select coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'position_livreur_en_direct' and jsonb_typeof(valeur) = 'boolean'), false);
$$;

-- Arrêt en cours d'un livreur : sa première livraison encore à faire, dans l'ordre de la tournée, si elle est partie.
-- Null sinon (rien en cours, ou la première est encore au restaurant).
create function arret_en_cours(p_livreur uuid) returns uuid
language sql stable as $$
  select case when x.statut = 'partie' then x.id end
  from (
    select o.id, o.statut
    from livraisons l join commandes o on o.id = l.commande_id
    where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    order by l.position, l.attribuee_le
    limit 1
  ) x;
$$;

-- Le téléphone du livreur envoie sa position (toutes les 15 à 30 secondes pendant le trajet).
-- Renvoie { statut: 'ok', numero } | { statut: 'pas_en_route' } | { statut: 'ignoree' } | { statut: 'desactive' }.
-- 'ignoree' : position hors de la région de Genève (signal GPS faux) ou trop imprécise, rien n'est écrit.
create function noter_position_livreur(p_livreur uuid, p_lat double precision, p_lon double precision, p_precision integer) returns jsonb
language plpgsql as $$
declare
  c uuid;
  n integer;
  lat4 numeric := round(p_lat::numeric, 4);
  lon4 numeric := round(p_lon::numeric, 4);
  ligne positions_livreur%rowtype;
  suite boolean;
begin
  delete from positions_livreur where le < now() - interval '15 minutes';
  delete from suites_livreur where le < now() - interval '1 hour';
  if not position_livreur_active() then
    delete from positions_livreur where livreur_id = p_livreur;
    return jsonb_build_object('statut', 'desactive');
  end if;
  if not exists (select 1 from personnel where id = p_livreur and actif and role = 'livreur') then
    raise exception 'livreur_inconnu';
  end if;
  c := arret_en_cours(p_livreur);
  if c is null then
    delete from positions_livreur where livreur_id = p_livreur;
    return jsonb_build_object('statut', 'pas_en_route');
  end if;
  if p_lat is null or p_lon is null or p_precision is null
     or p_lat not between 45.9 and 46.6 or p_lon not between 5.7 and 6.6 or p_precision not between 0 and 1000 then
    return jsonb_build_object('statut', 'ignoree');
  end if;
  select numero into n from commandes where id = c;
  select * into ligne from positions_livreur where livreur_id = p_livreur for update;
  if found and ligne.commande_id = c then
    -- Même arrêt : au plus une écriture toutes les 10 secondes, le point de masquage reste.
    if ligne.le > now() - interval '10 seconds' then
      return jsonb_build_object('statut', 'ok', 'numero', n);
    end if;
    update positions_livreur set lat = lat4, lon = lon4, precision_m = p_precision, le = now() where livreur_id = p_livreur;
    return jsonb_build_object('statut', 'ok', 'numero', n);
  end if;
  -- Premier point pour cet arrêt. S'il suit une livraison, il devient le point de masquage.
  suite := exists (select 1 from suites_livreur where livreur_id = p_livreur);
  delete from suites_livreur where livreur_id = p_livreur;
  insert into positions_livreur (livreur_id, commande_id, lat, lon, precision_m, le, masque_lat, masque_lon)
    values (p_livreur, c, lat4, lon4, p_precision, now(), case when suite then lat4 end, case when suite then lon4 end)
    on conflict (livreur_id) do update
      set commande_id = excluded.commande_id, lat = excluded.lat, lon = excluded.lon, precision_m = excluded.precision_m, le = excluded.le,
          masque_lat = excluded.masque_lat, masque_lon = excluded.masque_lon;
  return jsonb_build_object('statut', 'ok', 'numero', n);
end;
$$;

-- Le livreur coupe le partage, ou se déconnecte.
create function effacer_position_livreur(p_livreur uuid) returns void
language sql as $$
  delete from positions_livreur where livreur_id = p_livreur;
$$;

-- Suivi d'une commande : la position de son livreur seulement si cette commande est son arrêt en cours, si le livreur
-- est encore actif, et s'il est à 400 m au moins du point de masquage. Renvoie { lat, lon, precision, le } ou null.
create function position_pour_suivi(p_commande uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('lat', p.lat, 'lon', p.lon, 'precision', p.precision_m, 'le', p.le)
  from positions_livreur p
  join personnel pe on pe.id = p.livreur_id and pe.actif and pe.role = 'livreur'
  where p.commande_id = p_commande
    and p.le > now() - interval '2 minutes'
    and (p.masque_lat is null or distance_m(p.masque_lat, p.masque_lon, p.lat, p.lon) >= 400)
    and position_livreur_active()
    and arret_en_cours(p.livreur_id) = p_commande;
$$;

-- Effacement sur-le-champ : la commande quitte « partie » (livrée, client absent, annulée…), ou la livraison est
-- retirée, rendue ou donnée à un autre livreur.
create function effacer_position_commande() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'commandes' then
    if new.statut is distinct from 'partie' then
      delete from positions_livreur where commande_id = new.id;
      -- Arrêt terminé (livré, client absent clos, annulé) : son livreur est peut-être encore devant la porte.
      if old.statut = 'partie' then
        insert into suites_livreur (livreur_id, le)
          select l.livreur_id, now() from livraisons l where l.commande_id = new.id and l.retiree_le is null
          on conflict (livreur_id) do update set le = excluded.le;
      end if;
    end if;
  elsif new.retiree_le is not null or new.livreur_id is distinct from old.livreur_id then
    delete from positions_livreur where commande_id = new.commande_id;
    if exists (select 1 from commandes where id = new.commande_id and statut = 'partie') then
      insert into suites_livreur (livreur_id, le) values (old.livreur_id, now())
        on conflict (livreur_id) do update set le = excluded.le;
    end if;
  end if;
  return null;
end;
$$;

create trigger commandes_effacer_position after update of statut on commandes
  for each row execute function effacer_position_commande();
create trigger livraisons_effacer_position after update of retiree_le, livreur_id on livraisons
  for each row execute function effacer_position_commande();

revoke all on function distance_m(numeric, numeric, numeric, numeric), position_livreur_active(), arret_en_cours(uuid), noter_position_livreur(uuid, double precision, double precision, integer),
  effacer_position_livreur(uuid), position_pour_suivi(uuid), effacer_position_commande() from public, anon, authenticated;
grant execute on function distance_m(numeric, numeric, numeric, numeric), position_livreur_active(), arret_en_cours(uuid), noter_position_livreur(uuid, double precision, double precision, integer),
  effacer_position_livreur(uuid), position_pour_suivi(uuid) to service_role;
