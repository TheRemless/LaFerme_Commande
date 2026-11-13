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
-- - coordonnées arrondies à 4 décimales (une dizaine de mètres), sans historique ni journal.
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
  le timestamptz not null default now()
);
create index positions_livreur_commande_idx on positions_livreur (commande_id);

alter table positions_livreur enable row level security;
revoke all on positions_livreur from anon, authenticated;
grant select, insert, update, delete on positions_livreur to service_role;

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
begin
  delete from positions_livreur where le < now() - interval '15 minutes';
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
  -- Au plus une écriture toutes les 10 secondes pour le même arrêt.
  if exists (select 1 from positions_livreur where livreur_id = p_livreur and commande_id = c and le > now() - interval '10 seconds') then
    return jsonb_build_object('statut', 'ok', 'numero', n);
  end if;
  insert into positions_livreur (livreur_id, commande_id, lat, lon, precision_m, le)
    values (p_livreur, c, round(p_lat::numeric, 4), round(p_lon::numeric, 4), p_precision, now())
    on conflict (livreur_id) do update
      set commande_id = excluded.commande_id, lat = excluded.lat, lon = excluded.lon, precision_m = excluded.precision_m, le = excluded.le;
  return jsonb_build_object('statut', 'ok', 'numero', n);
end;
$$;

-- Le livreur coupe le partage, ou se déconnecte.
create function effacer_position_livreur(p_livreur uuid) returns void
language sql as $$
  delete from positions_livreur where livreur_id = p_livreur;
$$;

-- Suivi d'une commande : la position de son livreur seulement si cette commande est son arrêt en cours.
-- Renvoie { lat, lon, precision, le } ou null.
create function position_pour_suivi(p_commande uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('lat', p.lat, 'lon', p.lon, 'precision', p.precision_m, 'le', p.le)
  from positions_livreur p
  where p.commande_id = p_commande
    and p.le > now() - interval '2 minutes'
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
    end if;
  elsif new.retiree_le is not null or new.livreur_id is distinct from old.livreur_id then
    delete from positions_livreur where commande_id = new.commande_id;
  end if;
  return null;
end;
$$;

create trigger commandes_effacer_position after update of statut on commandes
  for each row execute function effacer_position_commande();
create trigger livraisons_effacer_position after update of retiree_le, livreur_id on livraisons
  for each row execute function effacer_position_commande();

revoke all on function position_livreur_active(), arret_en_cours(uuid), noter_position_livreur(uuid, double precision, double precision, integer),
  effacer_position_livreur(uuid), position_pour_suivi(uuid), effacer_position_commande() from public, anon, authenticated;
grant execute on function position_livreur_active(), arret_en_cours(uuid), noter_position_livreur(uuid, double precision, double precision, integer),
  effacer_position_livreur(uuid), position_pour_suivi(uuid) to service_role;
