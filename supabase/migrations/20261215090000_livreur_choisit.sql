-- Le livreur choisit ses commandes et son ordre ; le gérant ou le responsable peut livrer (vague 3, réponses de
-- Jérémy du 14.11.2026). Aucune table nouvelle.
--
-- 1. « Je prends » : prendre_livraison est atomique. La commande est verrouillée, puis on vérifie qu'aucune livraison
--    n'est active : de deux livreurs au même instant, un seul gagne, l'autre reçoit le nom de celui qui l'a prise.
--    livraisons_a_prendre liste les livraisons acceptées, tickets sortis, sans livreur, sans l'adresse complète.
-- 2. Ordre : le livreur range sa tournée avec la même fonction que la tablette (ordonner_livraisons, ordre manuel).
--    Si l'arrêt en cours change, sa position est effacée et la marque de masquage posée, comme après une livraison.
-- 3. peut_livrer : livreur actif, gérant actif, ou responsable actif quand role_responsable_actif est vrai. Utilisé
--    par les fonctions de livraison et de position (recréées à l'identique sauf ce contrôle). Les comptages de
--    capacité et le planning restent sur le rôle livreur.

create function peut_livrer(p_personnel uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from personnel
    where id = p_personnel and actif
      and (role in ('livreur', 'gerant') or (role = 'responsable' and role_responsable_actif()))
  );
$$;

create or replace function attribuer_livraison(p_commande uuid, p_livreur uuid, p_par text) returns text
language plpgsql as $$
declare
  c commandes%rowtype;
  avant livraisons%rowtype;
  nom_livreur text;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or c.mode <> 'livraison' or c.statut not in ('acceptee', 'en_preparation', 'partie') then
    return 'commande';
  end if;
  select nom into nom_livreur from personnel where id = p_livreur and peut_livrer(id);
  if nom_livreur is null then
    return 'livreur';
  end if;
  select * into avant from livraisons where commande_id = p_commande and retiree_le is null for update;
  if found and avant.livreur_id = p_livreur then
    return 'deja';
  end if;
  if found then
    update livraisons set retiree_le = now(), raison_retrait = 'reattribuee' where id = avant.id;
  end if;
  insert into livraisons (commande_id, livreur_id, position, attribuee_par)
  values (p_commande, p_livreur,
    coalesce((select max(l.position) + 1 from livraisons l join commandes o on o.id = l.commande_id
              where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')), 1),
    p_par);
  insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
  values (p_commande, p_livreur, p_par, case when avant.id is null then 'attribuee' else 'reattribuee' end,
    case when avant.id is null then nom_livreur else (select nom from personnel where id = avant.livreur_id) || ' → ' || nom_livreur end);
  return 'ok';
end;
$$;

create or replace function geste_livreur(p_cle text, p_livreur uuid, p_commande uuid, p_geste text, p_motif text default null, p_detail text default null)
returns jsonb
language plpgsql as $$
declare
  avant gestes_livreur%rowtype;
  l livraisons%rowtype;
  st text;
  par text;
  d text := nullif(btrim(regexp_replace(coalesce(p_detail, ''), '\s+', ' ', 'g')), '');
  r jsonb;
  noter boolean := true;
begin
  perform pg_advisory_xact_lock(hashtext('geste:' || p_cle));
  select * into avant from gestes_livreur where cle = p_cle;
  if found then
    if avant.livreur_id <> p_livreur or avant.commande_id <> p_commande or avant.geste <> p_geste then
      return jsonb_build_object('ok', false, 'raison', 'cle');
    end if;
    return avant.resultat || jsonb_build_object('deja', true, 'prevenir', false);
  end if;
  -- La route l'a déjà vérifié ; la base le revérifie : seul un livreur actif fait un geste.
  select 'livreur:' || nom into par from personnel where id = p_livreur and peut_livrer(id);
  if p_geste not in ('partie', 'livree', 'probleme', 'compris') or par is null then
    return jsonb_build_object('ok', false, 'raison', 'geste');
  end if;
  -- Commande d'abord, livraison ensuite : même ordre que attribuer_livraison et clore_client_absent.
  select statut into st from commandes where id = p_commande for update;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
  end if;

  if p_geste = 'compris' then
    update livraisons set retrait_vu_le = now(),
      retiree_le = coalesce(retiree_le, now()),
      raison_retrait = coalesce(raison_retrait, 'annulee')
    where id = (
      select x.id from livraisons x join commandes o on o.id = x.commande_id
      where x.commande_id = p_commande and x.livreur_id = p_livreur and x.retrait_vu_le is null
        and (x.retiree_le is not null or o.statut in ('refusee', 'annulee'))
      order by x.attribuee_le desc limit 1
    );
    if found then
      r := jsonb_build_object('ok', true, 'prevenir', false);
    elsif exists (select 1 from livraisons where commande_id = p_commande and livreur_id = p_livreur) then
      -- Déjà lu (second appui avec une autre clé) : rien à changer, rien à noter.
      r := jsonb_build_object('ok', true, 'prevenir', false);
      noter := false;
    else
      r := jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
    end if;
  else
    select * into l from livraisons where commande_id = p_commande and retiree_le is null for update;
    if l.id is null or l.livreur_id <> p_livreur then
      r := jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
    elsif st in ('refusee', 'annulee') then
      r := jsonb_build_object('ok', false, 'raison', 'annulee');
    elsif p_geste = 'partie' then
      if st = 'partie' then
        r := jsonb_build_object('ok', true, 'prevenir', false);
        noter := false;
      elsif st in ('acceptee', 'en_preparation') and changer_statut(p_commande, 'partie', par, null, null, st) then
        r := jsonb_build_object('ok', true, 'prevenir', true);
      else
        r := jsonb_build_object('ok', false, 'raison', 'statut');
      end if;
    elsif p_geste = 'livree' then
      -- « Livrée » sans « Je pars » avant : on passe par « partie » sans e-mail au client.
      if st in ('acceptee', 'en_preparation') then
        perform changer_statut(p_commande, 'partie', par, null, null, st);
        st := 'partie';
      end if;
      if st = 'partie' and changer_statut(p_commande, 'terminee', par, null, null, 'partie') then
        update livraisons set probleme = null, probleme_detail = null, probleme_le = null where id = l.id;
        r := jsonb_build_object('ok', true, 'prevenir', false);
      elsif st = 'terminee' then
        r := jsonb_build_object('ok', true, 'prevenir', false);
        noter := false;
      else
        r := jsonb_build_object('ok', false, 'raison', 'statut');
      end if;
    elsif st not in ('acceptee', 'en_preparation', 'partie') then
      r := jsonb_build_object('ok', false, 'raison', 'statut');
    else
      if p_motif is null or p_motif not in ('client_absent', 'adresse_introuvable', 'autre') then
        return jsonb_build_object('ok', false, 'raison', 'motif');
      end if;
      if p_motif = 'autre' and d is null then
        return jsonb_build_object('ok', false, 'raison', 'detail');
      end if;
      if length(d) > 200 then
        d := left(d, 200);
      end if;
      update livraisons set probleme = p_motif, probleme_detail = d, probleme_le = now() where id = l.id;
      r := jsonb_build_object('ok', true, 'prevenir', false);
    end if;
  end if;

  if (r ->> 'ok')::boolean and noter then
    insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
    values (p_commande, p_livreur, par, p_geste, case when p_geste = 'probleme' then p_motif || coalesce(' : ' || d, '') end);
  end if;
  insert into gestes_livreur (cle, livreur_id, commande_id, geste, resultat) values (p_cle, p_livreur, p_commande, p_geste, r);
  return r;
end;
$$;

create or replace function livreurs_tablette() returns jsonb
language sql stable as $$
  with en_cours as (
    select l.*, o.statut as commande_statut, o.numero
    from livraisons l join commandes o on o.id = l.commande_id
    where l.retiree_le is null and (o.statut in ('acceptee', 'en_preparation', 'partie') or o.statut in ('refusee', 'annulee'))
  )
  select jsonb_build_object(
    'livreurs', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nom', p.nom, 'actif', peut_livrer(p.id), 'role', p.role, 'vu_le', a.vu_le) order by p.nom)
      from personnel p left join activite_livreurs a on a.personnel_id = p.id
      where peut_livrer(p.id) or p.id in (select livreur_id from en_cours)
    ), '[]'::jsonb),
    'livraisons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', e.commande_id, 'numero', e.numero, 'livreur_id', e.livreur_id, 'position', e.position,
        'ordre_manuel', e.ordre_manuel, 'attribuee_le', e.attribuee_le, 'commande_statut', e.commande_statut,
        'probleme', e.probleme, 'probleme_detail', e.probleme_detail, 'probleme_le', e.probleme_le,
        'partie_le', (select max(v.le) from evenements_commande v where v.commande_id = e.commande_id and v.vers = 'partie')
      ) order by e.livreur_id, e.position, e.attribuee_le)
      from en_cours e
    ), '[]'::jsonb)
  );
$$;

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
  if not peut_livrer(p_livreur) then
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

create or replace function position_pour_suivi(p_commande uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('lat', p.lat, 'lon', p.lon, 'precision', p.precision_m, 'le', p.le)
  from positions_livreur p
  join personnel pe on pe.id = p.livreur_id and peut_livrer(pe.id)
  where p.commande_id = p_commande
    and p.le > now() - interval '2 minutes'
    and (p.masque_lat is null or distance_m(p.masque_lat, p.masque_lon, p.lat, p.lon) >= 400)
    and position_livreur_active()
    and arret_en_cours(p.livreur_id) = p_commande;
$$;

create or replace function ordonner_livraisons(p_livreur uuid, p_commandes uuid[], p_manuel boolean, p_par text) returns boolean
language plpgsql as $$
declare
  avant_arret uuid;
  i integer;
  n integer := 0;
  numeros text := '';
begin
  if p_commandes is null or cardinality(p_commandes) = 0 or cardinality(p_commandes) > 50 then
    return false;
  end if;
  perform 1 from livraisons where livreur_id = p_livreur and retiree_le is null for update;
  avant_arret := arret_en_cours(p_livreur);
  for i in 1 .. cardinality(p_commandes) loop
    update livraisons set position = i, ordre_manuel = p_manuel
      where commande_id = p_commandes[i] and livreur_id = p_livreur and retiree_le is null;
    if found then
      n := n + 1;
      numeros := numeros || case when numeros = '' then '' else ', ' end || (select numero::text from commandes where id = p_commandes[i]);
    end if;
  end loop;
  if n = 0 then
    return false;
  end if;
  -- Position en direct : l'arrêt en cours change d'ordre alors que le livreur était parti vers lui. Il est peut-être
  -- devant cette porte-là : même marque qu'un arrêt terminé, le premier point du nouvel arrêt devient un point de
  -- masquage (le client B ne voit jamais la porte du client A).
  if avant_arret is not null and arret_en_cours(p_livreur) is distinct from avant_arret then
    delete from positions_livreur where livreur_id = p_livreur;
    insert into suites_livreur (livreur_id, le, apres_commande) values (p_livreur, now(), avant_arret)
      on conflict (livreur_id) do update set le = excluded.le, apres_commande = excluded.apres_commande;
  end if;
  insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
  select l.commande_id, p_livreur, p_par, case when p_manuel then 'ordre_manuel' else 'ordre_propose' end, numeros
  from livraisons l where l.livreur_id = p_livreur and l.retiree_le is null and l.commande_id = any(p_commandes)
  order by l.position limit 1;
  return true;
end;
$$;

create function livraisons_a_prendre() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'commande_id', o.id, 'numero', o.numero, 'heure', o.heure_confirmee,
    'npa', o.adresse ->> 'npa', 'localite', o.adresse ->> 'localite', 'zone', o.zone_numero,
    'articles', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id),
    'pizzas', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id and x.station = 'pizza')
  ) order by o.heure_confirmee, o.numero), '[]'::jsonb)
  from commandes o
  where o.mode = 'livraison' and o.statut in ('acceptee', 'en_preparation') and o.tickets_le is not null
    and not exists (select 1 from livraisons l where l.commande_id = o.id and l.retiree_le is null);
$$;

-- Renvoie { ok: true } ou { ok: false, raison: 'prise', par } | { ok: false, raison: 'commande' | 'livreur' }.
create function prendre_livraison(p_commande uuid, p_livreur uuid) returns jsonb
language plpgsql as $$
declare
  c commandes%rowtype;
  qui text;
  deja text;
begin
  select nom into qui from personnel where id = p_livreur and peut_livrer(id);
  if qui is null then
    return jsonb_build_object('ok', false, 'raison', 'livreur');
  end if;
  -- Verrou sur la commande : deux « Je prends » au même instant passent l'un après l'autre.
  select * into c from commandes where id = p_commande for update;
  if not found or c.mode <> 'livraison' or c.statut not in ('acceptee', 'en_preparation') then
    return jsonb_build_object('ok', false, 'raison', 'commande');
  end if;
  select p.nom into deja from livraisons l join personnel p on p.id = l.livreur_id
    where l.commande_id = p_commande and l.retiree_le is null;
  if deja is not null then
    return jsonb_build_object('ok', false, 'raison', 'prise', 'par', deja);
  end if;
  insert into livraisons (commande_id, livreur_id, position, attribuee_par)
  values (p_commande, p_livreur,
    coalesce((select max(l.position) + 1 from livraisons l join commandes o on o.id = l.commande_id
              where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')), 1),
    'livreur:' || qui);
  insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
  values (p_commande, p_livreur, 'livreur:' || qui, 'prise', qui);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function peut_livrer(uuid), livraisons_a_prendre(), prendre_livraison(uuid, uuid) from public, anon, authenticated;
grant execute on function peut_livrer(uuid), livraisons_a_prendre(), prendre_livraison(uuid, uuid) to service_role;
