-- Correctifs de l'audit « samedi soir » (docs/audits/samedi-soir.md) : fiabilité pendant un gros service.
-- Rappel : Supabase refuse un UPDATE ou un DELETE sans WHERE appelé par l'API (safeupdate). Chaque
-- écriture des fonctions ci-dessous a sa condition (tests/unit/migrations.test.ts le vérifie).

-- ---------- SS-05 : numéro du jour de service ----------
-- Une commande à l'avance prenait un numéro du jour où elle était passée : deux « N° 001 » le même soir.
-- Le numéro suit désormais le jour où la commande est servie. La colonne jour reste le jour de la
-- commande (export comptable, date de vente).
alter table commandes add column jour_service date;
update commandes set jour_service = coalesce(case when quand_type = 'creneau' then quand_date end, jour) where jour_service is null;
alter table commandes alter column jour_service set not null;
alter table commandes drop constraint commandes_jour_numero_key;
create index commandes_jour_service_idx on commandes (jour_service, numero);
-- Les compteurs repartent au-dessus des numéros déjà donnés pour chaque jour de service.
insert into compteurs_jour (jour, dernier)
  select jour_service, max(numero) from commandes group by jour_service
  on conflict (jour) do update set dernier = greatest(compteurs_jour.dernier, excluded.dernier);

-- ---------- SS-02 : capacité par créneau ----------
-- Les réglages existaient (3 livraisons, 4 retraits, proposés au lot 3) mais rien ne les lisait.
-- Une commande pour un créneau précis est refusée quand le créneau est plein pour son mode. Comptent les
-- commandes ni refusées ni annulées ; un paiement en ligne commencé garde sa place 35 minutes (la session
-- Stripe dure 30 minutes). Zéro : pas de limite. Les « dès que possible » ne sont pas comptés.
create function creneau_plein(p_date date, p_minutes smallint, p_mode text) returns boolean
language sql stable as $$
  with cap as (
    select (valeur #>> '{}')::integer as n from reglages
    where cle = case p_mode when 'livraison' then 'capacite_livraisons_par_creneau' else 'capacite_retraits_par_creneau' end
  )
  select coalesce((select n from cap), 0) > 0 and (
    select count(*) from commandes c
    where c.quand_type = 'creneau' and c.quand_date = p_date and c.quand_minutes = p_minutes and c.mode = p_mode
      and c.statut not in ('refusee', 'annulee')
      and (c.statut <> 'paiement_en_attente' or c.cree_le > now() - interval '35 minutes')
  ) >= (select n from cap);
$$;

-- Même fonction qu'au lot 6 (rattachement au compte), plus : verrou sur la clé (deux clics simultanés
-- contre le vrai Postgres, SS-20), capacité du créneau (SS-02) et numéro du jour de service (SS-05).
create or replace function creer_commande(p jsonb) returns table (id uuid, numero integer, jeton_suivi text, deja boolean)
language plpgsql as $$
declare
  existante commandes%rowtype;
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  service date;
  n integer;
  nouvelle_id uuid;
  cid uuid := (p ->> 'compte_id')::uuid;
begin
  perform pg_advisory_xact_lock(hashtext('commande:' || (p ->> 'cle_idempotence')));
  select * into existante from commandes c where c.cle_idempotence = p ->> 'cle_idempotence';
  if found then
    return query select existante.id, existante.numero, existante.jeton_suivi, true;
    return;
  end if;
  service := case when p ->> 'quand_type' = 'creneau' then (p ->> 'quand_date')::date else aujourd_hui end;
  if p ->> 'quand_type' = 'creneau' then
    perform pg_advisory_xact_lock(hashtext('creneau:' || (p ->> 'quand_date') || ':' || (p ->> 'quand_minutes') || ':' || (p ->> 'mode')));
    if creneau_plein((p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, p ->> 'mode') then
      raise exception 'creneau_complet';
    end if;
  end if;
  insert into compteurs_jour as cj (jour, dernier) values (service, 1)
    on conflict (jour) do update set dernier = cj.dernier + 1
    returning cj.dernier into n;
  insert into commandes (
    numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
    client_prenom, client_nom, client_telephone, client_email, adresse, details_livraison, zone_numero,
    quand_type, quand_date, quand_minutes, pizzas_seulement,
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine,
    compte_id, compte_demande
  ) values (
    n, aujourd_hui, service, p ->> 'jeton_suivi', p ->> 'cle_idempotence', p ->> 'mode', p ->> 'statut', p ->> 'statut_paiement', p ->> 'moyen_paiement',
    p ->> 'client_prenom', p ->> 'client_nom', p ->> 'client_telephone', p ->> 'client_email', p -> 'adresse', p -> 'details_livraison',
    (p ->> 'zone_numero')::smallint,
    p ->> 'quand_type', (p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, (p ->> 'pizzas_seulement')::boolean,
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, (p ->> 'taux_tva_pourcent')::numeric, p ->> 'origine',
    cid, coalesce((p ->> 'compte_demande')::boolean, false) and cid is null
  ) returning commandes.id into nouvelle_id;
  insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, retraits, note)
  select nouvelle_id, (l.ordinality - 1)::smallint, l.v ->> 'slug', l.v ->> 'nom', (l.v ->> 'station')::station, (l.v ->> 'qte')::smallint,
         (l.v ->> 'unitaire_centimes')::integer, (l.v ->> 'total_centimes')::integer, l.v -> 'choix', l.v -> 'retraits', coalesce(l.v ->> 'note', '')
  from jsonb_array_elements(p -> 'lignes') with ordinality as l(v, ordinality);
  if cid is not null then
    perform completer_depuis_commande(cid, nouvelle_id);
  end if;
  return query select nouvelle_id, n, p ->> 'jeton_suivi', false;
end;
$$;

-- Capacité réglée par le gérant depuis le back-office (0 : sans limite), journalisée.
create function regler_capacite(p_mode text, p_valeur integer, p_personnel uuid) returns void
language plpgsql as $$
declare
  cle_reglage text := case p_mode when 'livraison' then 'capacite_livraisons_par_creneau' when 'retrait' then 'capacite_retraits_par_creneau' end;
  avant jsonb;
begin
  perform gerant_nom(p_personnel);
  if cle_reglage is null then
    raise exception 'Mode inconnu';
  end if;
  if p_valeur is null or p_valeur not between 0 and 50 then
    raise exception 'Capacité entre 0 et 50';
  end if;
  select valeur into avant from reglages where cle = cle_reglage;
  update reglages set valeur = to_jsonb(p_valeur), proposition = false where cle = cle_reglage;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'reglage', cle_reglage, avant, to_jsonb(p_valeur));
end;
$$;

-- ---------- SS-01 : pause automatique après une pause datée ----------
-- Une pause datée finie gardait sa date dans pause_jusqu_a : la pause automatique, qui n'agissait que sur
-- null, ne se déclenchait plus jamais. Seule une pause réellement en cours l'empêche désormais.
create or replace function pause_automatique() returns boolean
language plpgsql as $$
declare
  v jsonb := (select valeur from reglages where cle = 'pause_jusqu_a');
  en_cours boolean;
begin
  en_cours := case
    when v is null or jsonb_typeof(v) <> 'string' then false
    when v = '"sans-fin"'::jsonb then true
    else (v #>> '{}')::timestamptz > now()
  end;
  if en_cours then
    return false;
  end if;
  update reglages set valeur = '"sans-fin"'::jsonb where cle = 'pause_jusqu_a';
  update reglages set valeur = 'true'::jsonb where cle = 'pause_auto';
  return true;
end;
$$;

-- ---------- SS-06 : état attendu ----------
-- Accepter sur une tablette et refuser sur l'autre au même instant : les deux passaient (refus permis
-- depuis « acceptée »). La tablette envoie l'état qu'elle affichait (p_de) ; s'il a changé, rien ne se fait.
drop function changer_statut(uuid, text, text, timestamptz, text);
create function changer_statut(p_commande uuid, p_vers text, p_par text, p_heure timestamptz default null, p_motif text default null, p_de text default null)
returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
  permis boolean;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or (p_de is not null and c.statut <> p_de) then
    return false;
  end if;
  permis := case p_vers
    when 'acceptee' then c.statut = 'nouvelle' and p_heure is not null
    when 'refusee' then c.statut in ('nouvelle', 'acceptee', 'en_preparation') and coalesce(btrim(p_motif), '') <> ''
    when 'en_preparation' then c.statut = 'acceptee'
    when 'prete' then c.statut in ('acceptee', 'en_preparation') and c.mode = 'retrait'
    when 'partie' then c.statut in ('acceptee', 'en_preparation') and c.mode = 'livraison'
    when 'terminee' then c.statut in ('prete', 'partie')
    else false
  end;
  if not permis then
    return false;
  end if;
  update commandes set
    statut = p_vers,
    heure_confirmee = coalesce(p_heure, heure_confirmee),
    accepte_le = case when p_vers = 'acceptee' then now() else accepte_le end,
    termine_le = case when p_vers in ('terminee', 'refusee') then now() else termine_le end,
    motif = case when p_vers = 'refusee' then btrim(p_motif) else motif end
  where id = p_commande;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    values (p_commande, c.statut, p_vers, p_par, case when p_vers = 'refusee' then btrim(p_motif) when p_heure is not null then p_heure::text end);
  return true;
end;
$$;

-- ---------- SS-03 : annulation après acceptation ----------
-- Les tickets pas encore sortis d'une commande annulée quittent la file (état « annulee »). Renvoie les
-- postes qui ont déjà le ticket (imprimé ou en cours d'impression) : ils reçoivent un ticket « ANNULÉE ».
alter table taches_impression drop constraint taches_impression_etat_check;
alter table taches_impression add constraint taches_impression_etat_check
  check (etat in ('en_attente', 'envoyee', 'imprimee', 'echec', 'sans_imprimante', 'annulee'));

create function annuler_impression(p_commande uuid) returns jsonb
language plpgsql as $$
declare
  sorties jsonb;
begin
  select coalesce(jsonb_agg(distinct station::text), '[]'::jsonb) into sorties
    from taches_impression where commande_id = p_commande and etat in ('imprimee', 'envoyee');
  update taches_impression set etat = 'annulee'
    where commande_id = p_commande and etat in ('en_attente', 'envoyee', 'sans_imprimante', 'echec');
  return sorties;
end;
$$;

-- ---------- SS-07 : ticket renvoyé après une confirmation perdue ----------
-- Il ressortait identique. Il porte désormais une mention en tête.
alter table taches_impression add column relance boolean not null default false;

create or replace function passage_imprimante(p_jeton_hache text, p_mac text, p_statut_code text) returns jsonb
language plpgsql as $$
declare
  i imprimantes%rowtype;
  t uuid;
begin
  select * into i from imprimantes where jeton_hache = p_jeton_hache and actif for update;
  if not found then
    return null;
  end if;
  if p_mac is null or (i.mac is not null and i.mac <> p_mac) then
    return null;
  end if;
  update imprimantes set
    mac = coalesce(i.mac, p_mac),
    vue_le = now(),
    statut_code = left(p_statut_code, 40)
  where id = i.id;
  -- Une tâche envoyée mais jamais confirmée depuis 2 minutes repart, marquée comme renvoi.
  update taches_impression set etat = 'en_attente', relance = true
    where imprimante_id = i.id and etat = 'envoyee' and envoye_le < now() - interval '2 minutes';
  select id into t from taches_impression
    where imprimante_id = i.id and etat = 'en_attente'
    order by cree_le limit 1;
  return jsonb_build_object('imprimante', i.id, 'tache', t);
end;
$$;

create or replace function tache_pour_imprimante(p_jeton_hache text, p_mac text, p_tache uuid) returns jsonb
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
  if t.relance then
    return jsonb_build_array(jsonb_build_object('t', 'texte', 'texte', 'RENVOI : CE TICKET EST PEUT-ÊTRE DÉJÀ SORTI', 'gras', true)) || t.contenu;
  end if;
  return t.contenu;
end;
$$;

-- État des imprimantes et des tickets : en plus des 18 dernières heures, les tickets des commandes encore
-- en cours (une commande à l'avance acceptée trois jours plus tôt garde son état « imprimé » sur la tablette).
create or replace function etat_impression() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'imprimantes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'nom', i.nom, 'station', i.station, 'actif', i.actif, 'liee', i.mac is not null,
      'vue_le', i.vue_le, 'en_ligne', i.vue_le > now() - interval '60 seconds', 'statut_code', i.statut_code
    ) order by i.station, i.id) from imprimantes i), '[]'::jsonb),
    'taches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'commande_id', t.commande_id, 'station', t.station, 'etat', t.etat, 'reimpression', t.reimpression,
      'tentatives', t.tentatives, 'derniere_erreur', t.derniere_erreur, 'cree_le', t.cree_le
    ) order by t.cree_le) from taches_impression t
    where t.cree_le > now() - interval '18 hours'
       or exists (select 1 from commandes c where c.id = t.commande_id and c.statut in ('acceptee', 'en_preparation', 'prete', 'partie'))), '[]'::jsonb)
  );
$$;

-- ---------- SS-17 : « Réimprimer » pendant une panne ----------
-- Une réimpression ne crée pas de second ticket pour un poste dont le ticket attend encore en file.
create or replace function creer_taches_impression(p_commande uuid, p jsonb, p_reimpression boolean) returns integer
language plpgsql as $$
declare
  x jsonb;
  imp smallint;
  n integer := 0;
begin
  for x in select * from jsonb_array_elements(p) loop
    if p_reimpression and exists (
      select 1 from taches_impression
      where commande_id = p_commande and station = (x ->> 'station')::station and etat in ('en_attente', 'envoyee')
    ) then
      continue;
    end if;
    select id into imp from imprimantes where station = (x ->> 'station')::station and actif order by id limit 1;
    insert into taches_impression (commande_id, station, imprimante_id, contenu, reimpression, etat)
      values (p_commande, (x ->> 'station')::station, imp, x -> 'contenu', p_reimpression, case when imp is null then 'sans_imprimante' else 'en_attente' end);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------- SS-19 : tickets « sans imprimante » ----------
-- Une imprimante ajoutée ou réactivée reprend les tickets de son poste restés sans imprimante, pour les
-- commandes encore à préparer.
create function reprendre_sans_imprimante(p_imprimante smallint) returns void
language sql as $$
  update taches_impression t set imprimante_id = p_imprimante, etat = 'en_attente'
  where t.etat = 'sans_imprimante'
    and t.station = (select station from imprimantes where id = p_imprimante and actif)
    and exists (select 1 from commandes c where c.id = t.commande_id and c.statut in ('acceptee', 'en_preparation'));
$$;

create or replace function ajouter_imprimante(p_nom text, p_station station, p_jeton_hache text, p_personnel uuid) returns smallint
language plpgsql as $$
declare
  i imprimantes%rowtype;
begin
  perform gerant_nom(p_personnel);
  insert into imprimantes (nom, station, jeton_hache) values (p_nom, p_station, p_jeton_hache) returning * into i;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'imprimante', i.id::text, null, jsonb_build_object('nom', i.nom, 'station', i.station));
  perform reprendre_sans_imprimante(i.id);
  return i.id;
end;
$$;

create or replace function modifier_imprimante(p_id smallint, p_jeton_hache text, p_actif boolean, p_personnel uuid) returns boolean
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
  if p_actif = false then
    update taches_impression t set
      imprimante_id = (select id from imprimantes where station = t.station and actif order by id limit 1),
      etat = case when exists (select 1 from imprimantes where station = t.station and actif) then 'en_attente' else 'sans_imprimante' end
    where t.imprimante_id = p_id and t.etat in ('en_attente', 'envoyee');
  elsif p_actif = true then
    perform reprendre_sans_imprimante(p_id);
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, gerant_nom(p_personnel), 'imprimante', p_id::text,
      jsonb_build_object('actif', avant.actif),
      jsonb_build_object('actif', coalesce(p_actif, avant.actif), 'nouveau_jeton', p_jeton_hache is not null));
  return true;
end;
$$;

-- ---------- SS-08 : avertissement posé au paiement ----------
-- Une commande payée pendant une pause, avec un plat épuisé entre-temps ou trop tard pour l'heure
-- demandée arrivait sans rien dire. Le serveur note l'écart au paiement ; la tablette l'affiche.
alter table commandes add column avertissement text;

create function noter_avertissement(p_commande uuid, p_texte text) returns void
language sql as $$
  update commandes set avertissement = nullif(left(btrim(p_texte), 300), '') where id = p_commande;
$$;

-- ---------- SS-04, SS-08, SS-09 : file de la tablette ----------
-- Une commande refusée dont le remboursement n'est pas passé reste visible, quel que soit le jour.
-- La file donne l'avertissement et l'heure à partir de laquelle la commande attend (paiement en ligne
-- confirmé, ou création pour le comptoir).
create or replace function file_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.cree_le), '[]'::jsonb) from (
    select o.cree_le, jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'cree_le', o.cree_le, 'attend_depuis', coalesce(o.paye_le, o.cree_le),
      'mode', o.mode, 'statut', o.statut,
      'statut_paiement', o.statut_paiement, 'moyen_paiement', o.moyen_paiement,
      'client_prenom', o.client_prenom, 'client_nom', o.client_nom, 'client_telephone', o.client_telephone,
      'adresse', o.adresse, 'details_livraison', o.details_livraison, 'zone_numero', o.zone_numero,
      'quand_type', o.quand_type, 'quand_date', o.quand_date, 'quand_minutes', o.quand_minutes,
      'heure_confirmee', o.heure_confirmee, 'pizzas_seulement', o.pizzas_seulement,
      'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
      'motif', o.motif, 'avertissement', o.avertissement,
      'lignes', coalesce((
        select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte, 'station', l.station, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note) order by l.position)
        from commande_lignes l where l.commande_id = o.id
      ), '[]'::jsonb)
    ) as j
    from commandes o
    where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
       or (o.statut in ('terminee', 'refusee') and o.modifie_le >= ((now() at time zone 'Europe/Zurich')::date::timestamp at time zone 'Europe/Zurich'))
       or (o.statut = 'refusee' and o.statut_paiement = 'paye')
  ) x;
$$;

-- SS-09 : l'attente se compte depuis le paiement (un client qui reste 7 minutes sur la page TWINT ne
-- déclenche plus l'alerte dès son arrivée). Le serveur n'appelle plus cette fonction hors service.
create or replace function commandes_en_retard() returns jsonb
language plpgsql as $$
declare
  r jsonb;
  minutes integer := (select (valeur #>> '{}')::integer from reglages where cle = 'alerte_acceptation_minutes');
begin
  with c as (
    update commandes set alerte_le = now()
    where statut = 'nouvelle' and alerte_le is null
      and coalesce(paye_le, cree_le) < now() - make_interval(mins => minutes)
      and (quand_type = 'asap' or quand_date <= (now() at time zone 'Europe/Zurich')::date)
    returning id, numero, cree_le
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'cree_le', cree_le) order by numero), '[]'::jsonb) into r from c;
  return r;
end;
$$;

revoke execute on function
  creneau_plein(date, smallint, text), regler_capacite(text, integer, uuid),
  changer_statut(uuid, text, text, timestamptz, text, text), annuler_impression(uuid),
  reprendre_sans_imprimante(smallint), noter_avertissement(uuid, text)
  from public, anon, authenticated;
grant execute on function
  creneau_plein(date, smallint, text), regler_capacite(text, integer, uuid),
  changer_statut(uuid, text, text, timestamptz, text, text), annuler_impression(uuid),
  reprendre_sans_imprimante(smallint), noter_avertissement(uuid, text)
  to service_role;
