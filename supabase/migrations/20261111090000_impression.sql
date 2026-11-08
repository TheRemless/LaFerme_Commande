-- Lot 7c : impression des tickets (Star CloudPRNT), file en base, surveillance du service.
-- L'imprimante vient chercher ses tickets (elle interroge le site) : une URL et un jeton par imprimante.
-- Le jeton n'est gardé qu'en empreinte. À son premier passage, l'imprimante est liée à son adresse MAC ;
-- un autre appareil avec le même jeton est refusé.

create table imprimantes (
  id smallint generated always as identity primary key,
  nom text not null,
  station station not null,
  jeton_hache text not null unique,
  mac text check (mac ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'),
  actif boolean not null default true,
  vue_le timestamptz,
  statut_code text,
  cree_le timestamptz not null default now()
);

-- Une tâche par poste et par commande acceptée. Le ticket (lignes déjà mises en forme) est figé à la
-- création : une réimpression crée une nouvelle tâche.
create table taches_impression (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references commandes (id) on delete cascade,
  station station not null,
  -- Null : aucune imprimante active pour ce poste, le ticket s'affiche sur la tablette.
  imprimante_id smallint references imprimantes (id) on delete set null,
  contenu jsonb not null,
  reimpression boolean not null default false,
  etat text not null default 'en_attente' check (etat in ('en_attente', 'envoyee', 'imprimee', 'echec', 'sans_imprimante')),
  tentatives smallint not null default 0,
  derniere_erreur text,
  cree_le timestamptz not null default now(),
  envoye_le timestamptz,
  imprime_le timestamptz
);
create index taches_impression_file_idx on taches_impression (imprimante_id, etat, cree_le);
create index taches_impression_commande_idx on taches_impression (commande_id);

-- Alerte envoyée quand une commande attend trop longtemps d'être acceptée.
alter table commandes add column alerte_le timestamptz;

insert into reglages (cle, valeur, proposition) values
  ('alerte_acceptation_minutes', '5', true),
  ('pause_auto', 'false', false);

-- État interne de la surveillance : pas dans reglages (lisible par tous), une seule ligne, sans droit public.
create table surveillance_etat (
  id boolean primary key default true check (id),
  tablette_vue_le timestamptz,
  surveillance_le timestamptz
);
insert into surveillance_etat default values;
alter table surveillance_etat enable row level security;
revoke all on surveillance_etat from anon, authenticated;
grant select, insert, update on surveillance_etat to service_role;

alter table imprimantes enable row level security;
alter table taches_impression enable row level security;
revoke all on imprimantes, taches_impression from anon, authenticated;

-- ---------- Côté imprimante (CloudPRNT) ----------

-- Passage de l'imprimante (POST). Met à jour son état et renvoie la prochaine tâche, ou rien.
-- MAC liée au premier passage, contrôlée ensuite. Renvoie null si le jeton est inconnu ou la MAC refusée.
create function passage_imprimante(p_jeton_hache text, p_mac text, p_statut_code text) returns jsonb
language plpgsql as $$
declare
  i imprimantes%rowtype;
  t uuid;
begin
  select * into i from imprimantes where jeton_hache = p_jeton_hache and actif for update;
  if not found then
    return null;
  end if;
  -- Sans MAC, pas de liaison possible : refusé, comme une MAC étrangère.
  if p_mac is null or (i.mac is not null and i.mac <> p_mac) then
    return null;
  end if;
  update imprimantes set
    mac = coalesce(i.mac, p_mac),
    vue_le = now(),
    statut_code = left(p_statut_code, 40)
  where id = i.id;
  -- Une tâche envoyée mais jamais confirmée depuis 2 minutes repart (imprimante éteinte en cours de route).
  update taches_impression set etat = 'en_attente'
    where imprimante_id = i.id and etat = 'envoyee' and envoye_le < now() - interval '2 minutes';
  -- Seulement une tâche en attente : celle en cours d'impression n'est pas réannoncée (sinon double ticket).
  select id into t from taches_impression
    where imprimante_id = i.id and etat = 'en_attente'
    order by cree_le limit 1;
  return jsonb_build_object('imprimante', i.id, 'tache', t);
end;
$$;

-- Contenu d'une tâche pour l'imprimante (GET). Seulement une tâche de cette imprimante, pas encore imprimée.
create function tache_pour_imprimante(p_jeton_hache text, p_mac text, p_tache uuid) returns jsonb
language plpgsql as $$
declare
  i imprimantes%rowtype;
  t taches_impression%rowtype;
begin
  select * into i from imprimantes where jeton_hache = p_jeton_hache and actif;
  if not found or p_mac is null or i.mac is distinct from p_mac then
    return null;
  end if;
  update taches_impression set etat = 'envoyee', envoye_le = now()
    where id = p_tache and imprimante_id = i.id and etat in ('en_attente', 'envoyee')
    returning * into t;
  if not found then
    return null;
  end if;
  return t.contenu;
end;
$$;

-- Fin d'une tâche (DELETE) : code 2xx imprimée ; sinon échec, remise en file jusqu'à trois tentatives.
-- Renvoie le nouvel état ('imprimee', 'en_attente', 'echec') avec le numéro de commande, ou null.
create function confirmer_tache(p_jeton_hache text, p_mac text, p_tache uuid, p_code text) returns jsonb
language plpgsql as $$
declare
  i imprimantes%rowtype;
  t taches_impression%rowtype;
begin
  select * into i from imprimantes where jeton_hache = p_jeton_hache and actif;
  if not found or p_mac is null or i.mac is distinct from p_mac then
    return null;
  end if;
  if p_code like '2%' then
    update taches_impression set etat = 'imprimee', imprime_le = now()
      where id = p_tache and imprimante_id = i.id and etat in ('en_attente', 'envoyee')
      returning * into t;
  else
    update taches_impression set
      tentatives = tentatives + 1,
      derniere_erreur = left(p_code, 60),
      etat = case when tentatives + 1 >= 3 then 'echec' else 'en_attente' end
      where id = p_tache and imprimante_id = i.id and etat in ('en_attente', 'envoyee')
      returning * into t;
  end if;
  if not found then
    return null;
  end if;
  return jsonb_build_object('etat', t.etat, 'station', t.station, 'imprimante', i.nom, 'erreur', t.derniere_erreur,
    'numero', (select numero from commandes where id = t.commande_id));
end;
$$;

-- ---------- Côté restaurant ----------

-- Tâches d'une commande acceptée ou réimprimée : chacune va à la première imprimante active de son poste.
-- p = [{ "station": "pizza", "contenu": [...] }, ...]
create function creer_taches_impression(p_commande uuid, p jsonb, p_reimpression boolean) returns integer
language plpgsql as $$
declare
  x jsonb;
  imp smallint;
  n integer := 0;
begin
  for x in select * from jsonb_array_elements(p) loop
    select id into imp from imprimantes where station = (x ->> 'station')::station and actif order by id limit 1;
    insert into taches_impression (commande_id, station, imprimante_id, contenu, reimpression, etat)
      values (p_commande, (x ->> 'station')::station, imp, x -> 'contenu', p_reimpression, case when imp is null then 'sans_imprimante' else 'en_attente' end);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- État des imprimantes (en ligne si vue depuis moins de 60 s) et des tâches des commandes du jour.
create function etat_impression() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'imprimantes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'nom', i.nom, 'station', i.station, 'actif', i.actif, 'liee', i.mac is not null,
      'vue_le', i.vue_le, 'en_ligne', i.vue_le > now() - interval '60 seconds', 'statut_code', i.statut_code
    ) order by i.station, i.id) from imprimantes i), '[]'::jsonb),
    'taches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'commande_id', t.commande_id, 'station', t.station, 'etat', t.etat, 'reimpression', t.reimpression,
      'tentatives', t.tentatives, 'derniere_erreur', t.derniere_erreur, 'cree_le', t.cree_le
    ) order by t.cree_le) from taches_impression t where t.cree_le > now() - interval '18 hours'), '[]'::jsonb)
  );
$$;

-- Derniers tickets d'une commande (un par poste), pour l'affichage de secours sur la tablette.
create function tickets_commande(p_commande uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('station', x.station, 'contenu', x.contenu) order by x.station), '[]'::jsonb)
  from (
    select distinct on (station) station, contenu from taches_impression
    where commande_id = p_commande order by station, cree_le desc
  ) x;
$$;

-- Imprimantes, gérées depuis le back-office. Le jeton (en clair) n'est montré qu'une fois, à la création.
create function ajouter_imprimante(p_nom text, p_station station, p_jeton_hache text, p_personnel uuid) returns smallint
language plpgsql as $$
declare
  i imprimantes%rowtype;
begin
  perform gerant_nom(p_personnel);
  insert into imprimantes (nom, station, jeton_hache) values (p_nom, p_station, p_jeton_hache) returning * into i;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'imprimante', i.id::text, null, jsonb_build_object('nom', i.nom, 'station', i.station));
  return i.id;
end;
$$;

-- Nouveau jeton (ancien refusé aussitôt) et nouvelle liaison à la MAC, ou désactivation.
create function modifier_imprimante(p_id smallint, p_jeton_hache text, p_actif boolean, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant imprimantes%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from imprimantes where id = p_id for update;
  if not found then
    return false;
  end if;
  update imprimantes set
    jeton_hache = coalesce(p_jeton_hache, jeton_hache),
    mac = case when p_jeton_hache is not null then null else mac end,
    actif = coalesce(p_actif, actif)
  where id = p_id;
  -- Imprimante désactivée : ses tickets pas encore imprimés passent à une autre du même poste, sinon à la tablette.
  if p_actif = false then
    update taches_impression t set
      imprimante_id = (select id from imprimantes where station = t.station and actif order by id limit 1),
      etat = case when exists (select 1 from imprimantes where station = t.station and actif) then 'en_attente' else 'sans_imprimante' end
    where t.imprimante_id = p_id and t.etat in ('en_attente', 'envoyee');
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'imprimante', p_id::text,
      jsonb_build_object('actif', avant.actif),
      jsonb_build_object('actif', coalesce(p_actif, avant.actif), 'nouveau_jeton', p_jeton_hache is not null));
  return true;
end;
$$;

alter table journal_gestion drop constraint journal_gestion_objet_check;
alter table journal_gestion add constraint journal_gestion_objet_check
  check (objet in ('plat', 'option', 'retraits', 'zone', 'horaire', 'fermeture', 'import', 'imprimante', 'reglage'));

-- Délai avant l'alerte « commande pas encore acceptée », depuis le back-office.
create function regler_alerte(p_minutes integer, p_personnel uuid) returns void
language plpgsql as $$
declare
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  if p_minutes not between 2 and 60 then
    raise exception 'Délai entre 2 et 60 minutes';
  end if;
  select valeur into avant from reglages where cle = 'alerte_acceptation_minutes';
  update reglages set valeur = to_jsonb(p_minutes), proposition = false where cle = 'alerte_acceptation_minutes';
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'reglage', 'alerte_acceptation_minutes', avant, to_jsonb(p_minutes));
end;
$$;

-- ---------- Surveillance ----------

-- Signe de vie de la tablette (à chaque relecture de sa file).
create function signe_tablette() returns void
language sql as $$
  update surveillance_etat set tablette_vue_le = now();
$$;

-- Tablette sans signe de vie depuis p_secondes (jamais vue : pas encore en service, rien à signaler).
create function tablette_muette(p_secondes integer) returns boolean
language sql stable as $$
  select coalesce(tablette_vue_le < now() - make_interval(secs => p_secondes), false) from surveillance_etat;
$$;

-- Une seule surveillance par minute, même si plusieurs déclencheurs arrivent en même temps.
create function tour_de_surveillance() returns boolean
language plpgsql as $$
begin
  update surveillance_etat set surveillance_le = now()
    where surveillance_le is null or surveillance_le < now() - interval '60 seconds';
  return found;
end;
$$;

-- Commandes du jour à accepter qui attendent depuis plus que le délai réglé, sans alerte envoyée.
-- Marquées aussitôt : une seule alerte par commande.
create function commandes_en_retard() returns jsonb
language plpgsql as $$
declare
  r jsonb;
  minutes integer := (select (valeur #>> '{}')::integer from reglages where cle = 'alerte_acceptation_minutes');
begin
  with c as (
    update commandes set alerte_le = now()
    where statut = 'nouvelle' and alerte_le is null
      and cree_le < now() - make_interval(mins => minutes)
      and (quand_type = 'asap' or quand_date <= (now() at time zone 'Europe/Zurich')::date)
    returning id, numero, cree_le
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'cree_le', cree_le) order by numero), '[]'::jsonb) into r from c;
  return r;
end;
$$;

-- Tablette muette : pause automatique des commandes en ligne (une seule fois), levée à la main.
create function pause_automatique() returns boolean
language plpgsql as $$
begin
  if (select valeur from reglages where cle = 'pause_jusqu_a') <> 'null'::jsonb then
    return false;
  end if;
  update reglages set valeur = '"sans-fin"'::jsonb where cle = 'pause_jusqu_a';
  update reglages set valeur = 'true'::jsonb where cle = 'pause_auto';
  return true;
end;
$$;

-- La reprise depuis la tablette efface aussi la marque de pause automatique.
create or replace function regler_service(p jsonb, p_personnel uuid) returns void
language plpgsql as $$
begin
  if p ? 'pause_jusqu_a' then
    update reglages set valeur = coalesce(p -> 'pause_jusqu_a', 'null'::jsonb) where cle = 'pause_jusqu_a';
    update reglages set valeur = 'false'::jsonb where cle = 'pause_auto';
  end if;
  if p ? 'livraison_fermee' then
    update reglages set valeur = to_jsonb((p ->> 'livraison_fermee')::boolean) where cle = 'livraison_fermee';
  end if;
  if p ? 'preparation_minutes' then
    if (p ->> 'preparation_minutes')::integer not between 5 and 120 then
      raise exception 'Délai de préparation hors limites';
    end if;
    update reglages set valeur = to_jsonb((p ->> 'preparation_minutes')::integer) where cle = 'preparation_minutes';
  end if;
  insert into journal_personnel (personnel_id, evenement) values (p_personnel, 'reglages ' || p::text);
end;
$$;

revoke execute on function
  passage_imprimante(text, text, text), tache_pour_imprimante(text, text, uuid), confirmer_tache(text, text, uuid, text),
  creer_taches_impression(uuid, jsonb, boolean), etat_impression(), tickets_commande(uuid), ajouter_imprimante(text, station, text, uuid),
  modifier_imprimante(smallint, text, boolean, uuid), regler_alerte(integer, uuid), signe_tablette(), tablette_muette(integer), tour_de_surveillance(),
  commandes_en_retard(), pause_automatique()
  from public, anon, authenticated;
grant execute on function
  passage_imprimante(text, text, text), tache_pour_imprimante(text, text, uuid), confirmer_tache(text, text, uuid, text),
  creer_taches_impression(uuid, jsonb, boolean), etat_impression(), tickets_commande(uuid), ajouter_imprimante(text, station, text, uuid),
  modifier_imprimante(smallint, text, boolean, uuid), regler_alerte(integer, uuid), signe_tablette(), tablette_muette(integer), tour_de_surveillance(),
  commandes_en_retard(), pause_automatique()
  to service_role;
grant select, insert, update, delete on imprimantes, taches_impression to service_role;
grant usage on all sequences in schema public to service_role;
