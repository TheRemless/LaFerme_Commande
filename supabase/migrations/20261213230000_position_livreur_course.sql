-- Position du livreur : course du point de masquage (relecture BIS de qualite sur la #228).
-- Un point envoyé au moment où le livreur touche « Livrée » calculait c = l'arrêt qui se termine ; la marque
-- suites_livreur, posée par le geste entre-temps, était consommée par une ligne de cet arrêt, et le point suivant
-- (arrêt d'après, encore devant la porte d'avant) s'écrivait sans masque. Désormais la marque retient l'arrêt terminé
-- (apres_commande) et ne s'applique qu'à un autre arrêt. En plus, un point de plus de 100 m de précision n'est pas pris
-- comme point de masquage : rien n'est écrit, on attend le suivant.
-- Fonctions de 20261213210000 recréées à l'identique sauf ces deux points.

alter table suites_livreur add column apres_commande uuid;

create or replace function noter_position_livreur(p_livreur uuid, p_lat double precision, p_lon double precision, p_precision integer) returns jsonb
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
  -- Premier point pour cet arrêt. S'il suit un arrêt terminé, il devient le point de masquage. La marque ne vaut que
  -- pour un AUTRE arrêt que celui qui vient de se terminer : un point envoyé pendant « Livrée » (c = l'arrêt d'avant,
  -- calculé juste avant le geste) ne la consomme pas (relecture BIS de qualite).
  suite := exists (select 1 from suites_livreur where livreur_id = p_livreur and apres_commande is distinct from c);
  -- Point trop imprécis pour servir de masque (plus de 100 m) : rien n'est écrit, on attend le suivant.
  if suite and p_precision > 100 then
    return jsonb_build_object('statut', 'ignoree');
  end if;
  if suite then
    delete from suites_livreur where livreur_id = p_livreur;
  end if;
  insert into positions_livreur (livreur_id, commande_id, lat, lon, precision_m, le, masque_lat, masque_lon)
    values (p_livreur, c, lat4, lon4, p_precision, now(), case when suite then lat4 end, case when suite then lon4 end)
    on conflict (livreur_id) do update
      set commande_id = excluded.commande_id, lat = excluded.lat, lon = excluded.lon, precision_m = excluded.precision_m, le = excluded.le,
          masque_lat = excluded.masque_lat, masque_lon = excluded.masque_lon;
  return jsonb_build_object('statut', 'ok', 'numero', n);
end;
$$;

create or replace function effacer_position_commande() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'commandes' then
    if new.statut is distinct from 'partie' then
      delete from positions_livreur where commande_id = new.id;
      -- Arrêt terminé (livré, client absent clos, annulé) : son livreur est peut-être encore devant la porte.
      if old.statut = 'partie' then
        insert into suites_livreur (livreur_id, le, apres_commande)
          select l.livreur_id, now(), new.id from livraisons l where l.commande_id = new.id and l.retiree_le is null
          on conflict (livreur_id) do update set le = excluded.le, apres_commande = excluded.apres_commande;
      end if;
    end if;
  elsif new.retiree_le is not null or new.livreur_id is distinct from old.livreur_id then
    delete from positions_livreur where commande_id = new.commande_id;
    if exists (select 1 from commandes where id = new.commande_id and statut = 'partie') then
      insert into suites_livreur (livreur_id, le, apres_commande) values (old.livreur_id, now(), new.commande_id)
        on conflict (livreur_id) do update set le = excluded.le, apres_commande = excluded.apres_commande;
    end if;
  end if;
  return null;
end;
$$;
