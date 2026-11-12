-- Livreurs du restaurant (vague 2) : rôle « livreur », livraisons attribuées depuis la tablette, ordre de
-- passage, gestes du téléphone (« Je pars », « Livrée », « Problème ») sans doublon, journal complet.
-- Même modèle de sécurité que le reste : sécurité par ligne sans politique, droits retirés à anon et
-- authenticated, fonctions réservées au serveur du site (service_role).
--
-- Une « tournée » n'est pas une table : ce sont les livraisons en cours d'un même livreur, dans l'ordre
-- de leur position. Réattribuer une commande ferme sa ligne et en ouvre une autre, ce qui garde l'historique.

-- ---------- Rôle ----------

alter table personnel drop constraint personnel_role_check;
alter table personnel add constraint personnel_role_check check (role in ('service', 'gerant', 'livreur'));

-- Objets partagés recréés (signalé en tête de la PR) : dernières définitions de origin/main
-- (20261114090000_correctifs_gerant.sql, inchangées depuis), avec seulement le rôle livreur en plus.
create or replace function ajouter_personnel(p_email text, p_nom text, p_role text, p_personnel uuid) returns uuid
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  e text := lower(btrim(p_email));
  n text := btrim(regexp_replace(coalesce(p_nom, ''), '\s+', ' ', 'g'));
  avant personnel%rowtype;
  pid uuid;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) not between 5 and 120 then
    raise exception 'adresse_invalide';
  end if;
  if length(n) not between 1 and 60 then
    raise exception 'nom_invalide';
  end if;
  if p_role not in ('service', 'gerant', 'livreur') then
    raise exception 'role_invalide';
  end if;
  select * into avant from personnel where email = e for update;
  if found and avant.actif then
    raise exception 'deja_membre';
  end if;
  if found then
    update personnel set nom = n, role = p_role, actif = true where id = avant.id returning id into pid;
    update sessions_personnel set revoquee_le = now() where personnel_id = pid and revoquee_le is null;
  else
    insert into personnel (email, nom, role) values (e, n, p_role) returning id into pid;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', e,
    case when avant.id is null then null else jsonb_build_object('nom', avant.nom, 'role', avant.role, 'actif', avant.actif) end,
    jsonb_build_object('nom', n, 'role', p_role, 'actif', true));
  return pid;
end;
$$;

create or replace function modifier_personnel(p_id uuid, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant personnel%rowtype;
  apres personnel%rowtype;
  n text;
begin
  perform 1 from personnel where role = 'gerant' and actif for update;
  select * into avant from personnel where id = p_id for update;
  if not found then
    return false;
  end if;
  apres := avant;
  if p ? 'nom' then
    n := btrim(regexp_replace(coalesce(p ->> 'nom', ''), '\s+', ' ', 'g'));
    if length(n) not between 1 and 60 then
      raise exception 'nom_invalide';
    end if;
    apres.nom := n;
  end if;
  if p ? 'role' then
    if p ->> 'role' not in ('service', 'gerant', 'livreur') then
      raise exception 'role_invalide';
    end if;
    apres.role := p ->> 'role';
  end if;
  if p ? 'actif' then
    apres.actif := (p ->> 'actif')::boolean;
  end if;
  if avant.role = 'gerant' and avant.actif and not (apres.role = 'gerant' and apres.actif)
     and (select count(*) from personnel where role = 'gerant' and actif) <= 1 then
    raise exception 'dernier_gerant';
  end if;
  update personnel set nom = apres.nom, role = apres.role, actif = apres.actif where id = p_id;
  if not apres.actif then
    update sessions_personnel set revoquee_le = now() where personnel_id = p_id and revoquee_le is null;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', avant.email,
    jsonb_build_object('nom', avant.nom, 'role', avant.role, 'actif', avant.actif),
    jsonb_build_object('nom', apres.nom, 'role', apres.role, 'actif', apres.actif));
  return true;
end;
$$;

-- ---------- Annulation d'une commande partie ----------
-- Client absent, adresse introuvable : une commande partie doit pouvoir être annulée depuis la tablette
-- (remboursement comme pour toute annulation). changer_statut, partagée, n'est pas touchée : cette
-- fonction neuve ne fait que partie → refusee, avec la même trace dans evenements_commande.
create function annuler_commande_partie(p_commande uuid, p_par text, p_motif text) returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or c.statut <> 'partie' or coalesce(btrim(p_motif), '') = '' then
    return false;
  end if;
  update commandes set statut = 'refusee', termine_le = now(), motif = btrim(p_motif) where id = p_commande;
  insert into evenements_commande (commande_id, de, vers, par, detail) values (p_commande, 'partie', 'refusee', p_par, btrim(p_motif));
  return true;
end;
$$;

-- ---------- Tables ----------

-- Une ligne par attribution. Celle en cours a retiree_le nul (une seule par commande).
create table livraisons (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references commandes (id) on delete cascade,
  livreur_id uuid not null references personnel (id),
  position smallint not null default 0,
  -- Vrai dès qu'on a déplacé une livraison à la main : l'ordre proposé ne l'écrase plus.
  ordre_manuel boolean not null default false,
  attribuee_le timestamptz not null default now(),
  attribuee_par text not null,
  retiree_le timestamptz,
  raison_retrait text check (raison_retrait in ('reattribuee', 'retiree', 'annulee')),
  -- Le livreur a lu « retirée » ou « annulée » sur son téléphone.
  retrait_vu_le timestamptz,
  probleme text check (probleme in ('client_absent', 'adresse_introuvable', 'autre')),
  probleme_detail text check (length(probleme_detail) <= 200),
  probleme_le timestamptz
);
create unique index livraisons_en_cours_idx on livraisons (commande_id) where retiree_le is null;
create index livraisons_livreur_idx on livraisons (livreur_id, attribuee_le);

-- Gestes du téléphone : la clé vient du téléphone, un geste renvoyé après une coupure du réseau rend la
-- même réponse sans rien refaire (pas de deuxième e-mail au client).
create table gestes_livreur (
  cle text primary key check (cle ~ '^[A-Za-z0-9-]{16,64}$'),
  livreur_id uuid not null references personnel (id) on delete cascade,
  commande_id uuid not null references commandes (id) on delete cascade,
  geste text not null,
  resultat jsonb not null,
  le timestamptz not null default now()
);

-- Qui a fait quoi sur une livraison, tablette ou téléphone. « vue » : première fois qu'un livreur a reçu
-- l'adresse d'une commande sur son téléphone.
create table journal_livraisons (
  id bigint generated always as identity primary key,
  commande_id uuid not null references commandes (id) on delete cascade,
  personnel_id uuid references personnel (id) on delete set null,
  par text not null,
  evenement text not null,
  detail text,
  le timestamptz not null default now()
);
create index journal_livraisons_idx on journal_livraisons (commande_id, le);
create unique index journal_livraisons_vue_idx on journal_livraisons (commande_id, personnel_id) where evenement = 'vue';

-- Dernière relecture de la page /livreur : la tablette voit qui est connecté.
create table activite_livreurs (
  personnel_id uuid primary key references personnel (id) on delete cascade,
  vu_le timestamptz not null
);

alter table livraisons enable row level security;
alter table gestes_livreur enable row level security;
alter table journal_livraisons enable row level security;
alter table activite_livreurs enable row level security;
revoke all on livraisons, gestes_livreur, journal_livraisons, activite_livreurs from anon, authenticated;

-- ---------- Tablette ----------

-- Livreurs actifs (et ceux retirés qui ont encore une livraison), avec leur dernier passage sur /livreur,
-- et les livraisons en cours. Une commande annulée reste listée tant que son livreur ne l'a pas lu.
create function livreurs_tablette() returns jsonb
language sql stable as $$
  with en_cours as (
    select l.*, o.statut as commande_statut, o.numero
    from livraisons l join commandes o on o.id = l.commande_id
    where l.retiree_le is null and (o.statut in ('acceptee', 'en_preparation', 'partie') or o.statut in ('refusee', 'annulee'))
  )
  select jsonb_build_object(
    'livreurs', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nom', p.nom, 'actif', p.actif and p.role = 'livreur', 'vu_le', a.vu_le) order by p.nom)
      from personnel p left join activite_livreurs a on a.personnel_id = p.id
      where (p.role = 'livreur' and p.actif) or p.id in (select livreur_id from en_cours)
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

-- Ce qu'il faut pour proposer un ordre de passage : zone, adresse, heure promise.
create function livraisons_a_ordonner(p_livreur uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'commande_id', l.commande_id, 'statut', o.statut, 'zone', o.zone_numero,
    'npa', o.adresse ->> 'npa', 'rue', o.adresse ->> 'rue', 'numero', o.adresse ->> 'numero',
    'heure', o.heure_confirmee, 'position', l.position, 'ordre_manuel', l.ordre_manuel
  ) order by l.position, l.attribuee_le), '[]'::jsonb)
  from livraisons l join commandes o on o.id = l.commande_id
  where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie');
$$;

-- Donne une commande en livraison, acceptée et pas encore livrée, à un livreur actif. Si un autre l'avait,
-- sa ligne est fermée (« réattribuée ») : il le lit sur son téléphone. Renvoie 'ok', 'deja', 'commande'
-- (commande pas attribuable) ou 'livreur' (pas un livreur actif).
create function attribuer_livraison(p_commande uuid, p_livreur uuid, p_par text) returns text
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
  select nom into nom_livreur from personnel where id = p_livreur and role = 'livreur' and actif;
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

-- Reprend la commande au livreur (elle redevient « à attribuer »).
create function retirer_livraison(p_commande uuid, p_par text) returns boolean
language plpgsql as $$
declare
  l livraisons%rowtype;
begin
  update livraisons set retiree_le = now(), raison_retrait = 'retiree'
    where commande_id = p_commande and retiree_le is null
    returning * into l;
  if not found then
    return false;
  end if;
  insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
  values (p_commande, l.livreur_id, p_par, 'retiree', (select nom from personnel where id = l.livreur_id));
  return true;
end;
$$;

-- Range les livraisons en cours d'un livreur dans l'ordre donné (1, 2, 3…). p_manuel : ordre choisi à la
-- main (gardé ensuite), ou proposé (recalculé à chaque attribution). Les commandes qui ne sont pas à ce
-- livreur sont ignorées.
create function ordonner_livraisons(p_livreur uuid, p_commandes uuid[], p_manuel boolean, p_par text) returns boolean
language plpgsql as $$
declare
  i integer;
  n integer := 0;
  numeros text := '';
begin
  if p_commandes is null or cardinality(p_commandes) = 0 or cardinality(p_commandes) > 50 then
    return false;
  end if;
  perform 1 from livraisons where livreur_id = p_livreur and retiree_le is null for update;
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
  insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
  select l.commande_id, p_livreur, p_par, case when p_manuel then 'ordre_manuel' else 'ordre_propose' end, numeros
  from livraisons l where l.livreur_id = p_livreur and l.retiree_le is null and l.commande_id = any(p_commandes)
  order by l.position limit 1;
  return true;
end;
$$;

-- La tablette a pris en charge le problème signalé (client rappelé, nouvelle adresse) : on l'efface.
create function regler_probleme_livraison(p_commande uuid, p_par text) returns boolean
language plpgsql as $$
declare
  l livraisons%rowtype;
begin
  update livraisons set probleme = null, probleme_detail = null, probleme_le = null
    where commande_id = p_commande and retiree_le is null and probleme is not null
    returning * into l;
  if not found then
    return false;
  end if;
  insert into journal_livraisons (commande_id, personnel_id, par, evenement) values (p_commande, l.livreur_id, p_par, 'probleme_regle');
  return true;
end;
$$;

-- ---------- Téléphone du livreur ----------

-- Les livraisons en cours du livreur, dans l'ordre, avec seulement ce qu'il faut pour livrer. Une
-- commande livrée n'y est plus. « retirees » : commandes qui lui ont été reprises ou qui ont été annulées
-- et qu'il n'a pas encore lues, avec leur numéro seulement (aucune adresse).
-- Note aussi son passage (pour la tablette) et la première remise de chaque adresse (journal « vue »).
create function livraisons_livreur(p_livreur uuid) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  insert into activite_livreurs (personnel_id, vu_le) values (p_livreur, now())
    on conflict (personnel_id) do update set vu_le = excluded.vu_le;
  insert into journal_livraisons (commande_id, personnel_id, par, evenement)
    select l.commande_id, p_livreur, 'livreur:' || p.nom, 'vue'
    from livraisons l join commandes o on o.id = l.commande_id join personnel p on p.id = p_livreur
    where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    on conflict do nothing;
  select jsonb_build_object(
    'livraisons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', o.id, 'numero', o.numero, 'statut', o.statut, 'heure', o.heure_confirmee,
        'adresse', jsonb_build_object('rue', o.adresse ->> 'rue', 'numero', o.adresse ->> 'numero', 'npa', o.adresse ->> 'npa', 'localite', o.adresse ->> 'localite'),
        'details', o.details_livraison, 'zone', o.zone_numero,
        'prenom', o.client_prenom, 'telephone', o.client_telephone,
        'articles', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id),
        'pizzas', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id and x.station = 'pizza'),
        'paye', o.statut_paiement = 'paye', 'total_centimes', o.total_centimes,
        'probleme', l.probleme, 'probleme_detail', l.probleme_detail
      ) order by l.position, l.attribuee_le)
      from livraisons l join commandes o on o.id = l.commande_id
      where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    ), '[]'::jsonb),
    'retirees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', o.id, 'numero', o.numero,
        'raison', case when l.retiree_le is null or l.raison_retrait = 'annulee' then 'annulee' else l.raison_retrait end,
        'partie', exists (select 1 from evenements_commande v where v.commande_id = o.id and v.vers = 'partie')
      ) order by o.numero)
      from livraisons l join commandes o on o.id = l.commande_id
      where l.livreur_id = p_livreur and l.retrait_vu_le is null and l.attribuee_le > now() - interval '12 hours'
        and ((l.retiree_le is not null and l.raison_retrait in ('reattribuee', 'retiree')
              -- Rendue au même livreur entre-temps : elle est dans sa liste, pas d'alerte.
              and not exists (select 1 from livraisons y where y.commande_id = l.commande_id and y.livreur_id = p_livreur and y.retiree_le is null))
          or (l.retiree_le is null and o.statut in ('refusee', 'annulee')))
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- Un geste du livreur : 'partie' (« Je pars »), 'livree', 'probleme' (motif et mot libre) ou 'compris'
-- (il a lu qu'une commande lui est reprise ou annulée). Contrôle que la livraison est bien à lui.
-- Renvoie { ok, prevenir, raison? } ; prevenir : le serveur envoie l'e-mail « en route » au client.
-- Même clé déjà reçue : même réponse, avec deja = vrai et prevenir = faux.
create function geste_livreur(p_cle text, p_livreur uuid, p_commande uuid, p_geste text, p_motif text default null, p_detail text default null)
returns jsonb
language plpgsql as $$
declare
  avant gestes_livreur%rowtype;
  l livraisons%rowtype;
  st text;
  par text;
  d text := nullif(btrim(regexp_replace(coalesce(p_detail, ''), '\s+', ' ', 'g')), '');
  r jsonb;
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
  select 'livreur:' || nom into par from personnel where id = p_livreur and role = 'livreur' and actif;
  if p_geste not in ('partie', 'livree', 'probleme', 'compris') or par is null then
    return jsonb_build_object('ok', false, 'raison', 'geste');
  end if;
  if not exists (select 1 from commandes where id = p_commande) then
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
    r := jsonb_build_object('ok', true, 'prevenir', false);
  else
    select * into l from livraisons where commande_id = p_commande and retiree_le is null for update;
    select statut into st from commandes where id = p_commande for update;
    if l.id is null or l.livreur_id <> p_livreur then
      r := jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
    elsif st in ('refusee', 'annulee') then
      r := jsonb_build_object('ok', false, 'raison', 'annulee');
    elsif p_geste = 'partie' then
      if st = 'partie' then
        r := jsonb_build_object('ok', true, 'prevenir', false);
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
      else
        r := jsonb_build_object('ok', false, 'raison', 'statut');
      end if;
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

  if (r ->> 'ok')::boolean then
    insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
    values (p_commande, p_livreur, par, p_geste, case when p_geste = 'probleme' then p_motif || coalesce(' : ' || d, '') end);
  end if;
  insert into gestes_livreur (cle, livreur_id, commande_id, geste, resultat) values (p_cle, p_livreur, p_commande, p_geste, r);
  return r;
end;
$$;

-- Journal d'une commande pour le back-office et les contrôles : attributions, ordre, gestes, lectures.
create function journal_livraison(p_commande uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('le', j.le, 'par', j.par, 'evenement', j.evenement, 'detail', j.detail) order by j.le, j.id), '[]'::jsonb)
  from journal_livraisons j where j.commande_id = p_commande;
$$;

revoke execute on function
  annuler_commande_partie(uuid, text, text),
  livreurs_tablette(), livraisons_a_ordonner(uuid), attribuer_livraison(uuid, uuid, text), retirer_livraison(uuid, text),
  ordonner_livraisons(uuid, uuid[], boolean, text), regler_probleme_livraison(uuid, text), livraisons_livreur(uuid),
  geste_livreur(text, uuid, uuid, text, text, text), journal_livraison(uuid)
  from public, anon, authenticated;
grant execute on function
  annuler_commande_partie(uuid, text, text),
  livreurs_tablette(), livraisons_a_ordonner(uuid), attribuer_livraison(uuid, uuid, text), retirer_livraison(uuid, text),
  ordonner_livraisons(uuid, uuid[], boolean, text), regler_probleme_livraison(uuid, text), livraisons_livreur(uuid),
  geste_livreur(text, uuid, uuid, text, text, text), journal_livraison(uuid)
  to service_role;
grant select, insert, update, delete on livraisons, gestes_livreur, journal_livraisons, activite_livreurs to service_role;
grant usage on all sequences in schema public to service_role;
