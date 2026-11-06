-- Lot 7a : tablette du restaurant.
-- Personnel distinct des comptes clients (tables, cookie et empreintes à part). Même modèle de sécurité :
-- sécurité par ligne sans politique, droits retirés à anon et authenticated, fonctions réservées au serveur.

create table personnel (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) between 5 and 120),
  nom text not null,
  -- service : la tablette. gerant : la tablette et le back-office (lot 7b).
  role text not null check (role in ('service', 'gerant')),
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create table sessions_personnel (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references personnel (id) on delete cascade,
  jeton_hache text not null unique,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  revoquee_le timestamptz
);
create index sessions_personnel_idx on sessions_personnel (personnel_id);

-- Chaque changement d'une commande, avec son auteur : « tablette:Prénom », « webhook », « client »…
create table evenements_commande (
  id bigint generated always as identity primary key,
  commande_id uuid not null references commandes (id) on delete cascade,
  de text,
  vers text not null,
  par text not null,
  detail text,
  le timestamptz not null default now()
);
create index evenements_commande_idx on evenements_commande (commande_id, le);

create table journal_personnel (
  id bigint generated always as identity primary key,
  personnel_id uuid references personnel (id) on delete set null,
  evenement text not null,
  ip_court text,
  le timestamptz not null default now()
);

alter table commandes add column accepte_le timestamptz;
alter table commandes add column termine_le timestamptz;

-- Rupture du jour : le plat redevient commandable le lendemain sans que personne n'y touche.
alter table plats add column rupture_jour date;

-- Même vue qu'au lot 4 ; la raison de rupture tient compte de la rupture du jour (heure de Genève).
create or replace view carte_publique with (security_invoker = true) as
select
  c.slug as categorie_slug,
  c.nom as categorie_nom,
  c.ordre as categorie_ordre,
  p.slug,
  p.nom,
  p.description,
  p.prix_centimes,
  p.prix_a_valider,
  p.photo,
  p.ordre,
  coalesce(
    p.rupture_motif,
    case when p.rupture_jour = (now() at time zone 'Europe/Zurich')::date then 'Épuisé pour aujourd''hui.' end
  ) as rupture_motif,
  p.provenance,
  p.provenances_a_fournir,
  p.allergenes,
  exists (select 1 from plat_groupes g where g.plat_id = p.id)
    or exists (select 1 from plat_retraits r where r.plat_id = p.id) as a_options,
  p.station
from plats p
join categories c on c.id = p.categorie_id;

-- Pause des commandes en ligne (jusqu'à une heure, ou sans fin tant qu'on ne reprend pas) et livraison fermée.
-- Lisibles par tous, comme les autres réglages : l'accueil en a besoin pour le dire au client.
insert into reglages (cle, valeur, proposition) values
  ('pause_jusqu_a', 'null', false),
  ('livraison_fermee', 'false', false);

alter table personnel enable row level security;
alter table sessions_personnel enable row level security;
alter table evenements_commande enable row level security;
alter table journal_personnel enable row level security;
revoke all on personnel, sessions_personnel, evenements_commande, journal_personnel from anon, authenticated;

-- Compte de test pour les préversions (code affiché à l'écran, adresse en .test). À retirer avant la mise
-- en ligne : liste de contrôle du lot 8, docs/PROMPT.md §11.
insert into personnel (email, nom, role) values ('equipe@laferme.test', 'Équipe test', 'gerant');

-- ---------- Connexion du personnel ----------

-- Prépare un code pour un membre du personnel actif. Renvoie les secondes à attendre, 0 si le code est
-- créé, -1 pour une adresse inconnue : rien n'est créé ni envoyé, mais les compteurs avancent pareil et
-- la page de connexion répond la même chose.
create function demander_code_personnel(p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text)
returns integer
language plpgsql as $$
declare
  a integer;
  pid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  a := greatest(
    attente_limite('envoi_email', p_cle_email, 5, interval '1 hour', 30, 1),
    attente_limite('envoi_ip', p_cle_ip, 20, interval '1 hour', 0, 0)
  );
  if a > 0 then
    return a;
  end if;
  insert into tentatives_connexion (action, cle) values ('envoi_email', p_cle_email), ('envoi_ip', p_cle_ip);
  select id into pid from personnel where email = p_email and actif;
  if pid is null then
    return -1;
  end if;
  update codes_connexion set invalide_le = now()
    where cle_email = p_cle_email and utilise_le is null and invalide_le is null;
  insert into codes_connexion (cle_email, code_hache, expire_le) values (p_cle_email, p_code_hache, now() + interval '10 minutes');
  insert into journal_personnel (personnel_id, evenement, ip_court) values (pid, 'code_demande', p_ip_court);
  return 0;
end;
$$;

-- Même règles que pour les clients : usage unique, 10 minutes, 5 essais, délais croissants, limites par IP.
-- Bon code : session neuve de 60 jours (tablette), l'ancienne du navigateur est fermée.
create function verifier_code_personnel(
  p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text,
  p_session_hache text, p_ancienne_session_hache text default null
) returns jsonb
language plpgsql as $$
declare
  a integer;
  k codes_connexion%rowtype;
  trouve boolean;
  pid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  a := attente_limite('echec_ip', p_cle_ip, 30, interval '1 hour', 2, 5);
  if a > 0 then
    return jsonb_build_object('statut', 'attente', 'attente', a);
  end if;
  select * into k from codes_connexion
    where cle_email = p_cle_email and utilise_le is null and invalide_le is null and expire_le > now()
    order by cree_le desc limit 1
    for update;
  trouve := found;
  if trouve and k.prochain_essai_le > now() then
    return jsonb_build_object('statut', 'attente', 'attente', greatest(1, ceil(extract(epoch from (k.prochain_essai_le - now())))::integer));
  end if;
  select id into pid from personnel where email = p_email and actif;
  if not trouve or pid is null or not egal_constant(k.code_hache, p_code_hache) then
    insert into tentatives_connexion (action, cle) values ('echec_ip', p_cle_ip);
    if trouve then
      update codes_connexion set
        essais = essais + 1,
        prochain_essai_le = now() + make_interval(secs => power(2, essais)),
        invalide_le = case when essais + 1 >= 5 then now() else null end
      where id = k.id;
    end if;
    insert into journal_personnel (personnel_id, evenement, ip_court) values (pid, 'echec_code', p_ip_court);
    return jsonb_build_object('statut', 'invalide');
  end if;
  update codes_connexion set utilise_le = now() where id = k.id;
  if p_ancienne_session_hache is not null then
    update sessions_personnel set revoquee_le = now() where jeton_hache = p_ancienne_session_hache and revoquee_le is null;
  end if;
  insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values (pid, p_session_hache, now() + interval '60 days');
  insert into journal_personnel (personnel_id, evenement, ip_court) values (pid, 'connexion', p_ip_court);
  return jsonb_build_object('statut', 'ok');
end;
$$;

-- Membre du personnel d'une session valable et toujours actif, sinon null.
create function personnel_de_session(p_session_hache text) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'nom', p.nom, 'role', p.role)
  from sessions_personnel s join personnel p on p.id = s.personnel_id
  where s.jeton_hache = p_session_hache and s.revoquee_le is null and s.expire_le > now() and p.actif;
$$;

create function deconnecter_personnel(p_session_hache text, p_ip_court text) returns void
language plpgsql as $$
declare
  pid uuid;
begin
  update sessions_personnel set revoquee_le = now()
    where jeton_hache = p_session_hache and revoquee_le is null
    returning personnel_id into pid;
  if pid is not null then
    insert into journal_personnel (personnel_id, evenement, ip_court) values (pid, 'deconnexion', p_ip_court);
  end if;
end;
$$;

-- ---------- File de la tablette ----------

-- Commandes à traiter et en cours, plus celles terminées ou refusées depuis le début de la journée.
-- Les commandes en attente de paiement ou annulées n'y apparaissent jamais.
create function file_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.cree_le), '[]'::jsonb) from (
    select o.cree_le, jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'cree_le', o.cree_le, 'mode', o.mode, 'statut', o.statut,
      'statut_paiement', o.statut_paiement, 'moyen_paiement', o.moyen_paiement,
      'client_prenom', o.client_prenom, 'client_nom', o.client_nom, 'client_telephone', o.client_telephone,
      'adresse', o.adresse, 'details_livraison', o.details_livraison, 'zone_numero', o.zone_numero,
      'quand_type', o.quand_type, 'quand_date', o.quand_date, 'quand_minutes', o.quand_minutes,
      'heure_confirmee', o.heure_confirmee, 'pizzas_seulement', o.pizzas_seulement,
      'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
      'motif', o.motif,
      'lignes', coalesce((
        select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte, 'station', l.station, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note) order by l.position)
        from commande_lignes l where l.commande_id = o.id
      ), '[]'::jsonb)
    ) as j
    from commandes o
    where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
       or (o.statut in ('terminee', 'refusee') and o.modifie_le >= ((now() at time zone 'Europe/Zurich')::date::timestamp at time zone 'Europe/Zurich'))
  ) x;
$$;

-- Change le statut d'une commande depuis la tablette. Les passages permis :
--   nouvelle → acceptee (avec l'heure confirmée) ou refusee
--   acceptee → en_preparation, prete (retrait), partie (livraison) ou refusee
--   en_preparation → prete ou partie, ou refusee
--   prete, partie → terminee
-- Renvoie faux si la commande n'est pas dans l'état attendu (deux tablettes, double appui).
create function changer_statut(p_commande uuid, p_vers text, p_par text, p_heure timestamptz default null, p_motif text default null)
returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
  permis boolean;
begin
  select * into c from commandes where id = p_commande for update;
  if not found then
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

-- Nouvelle heure pour une commande acceptée et pas encore terminée.
create function changer_heure(p_commande uuid, p_heure timestamptz, p_par text) returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or c.statut not in ('acceptee', 'en_preparation', 'prete', 'partie') or c.heure_confirmee = p_heure then
    return false;
  end if;
  update commandes set heure_confirmee = p_heure where id = p_commande;
  insert into evenements_commande (commande_id, de, vers, par, detail) values (p_commande, c.statut, c.statut, p_par, 'heure ' || p_heure::text);
  return true;
end;
$$;

-- Paiement au comptoir reçu.
create function marquer_encaisse(p_commande uuid, p_par text) returns boolean
language plpgsql as $$
begin
  update commandes set statut_paiement = 'encaisse'
    where id = p_commande and statut_paiement = 'a_encaisser_retrait' and statut not in ('refusee', 'annulee');
  if not found then
    return false;
  end if;
  insert into evenements_commande (commande_id, de, vers, par, detail) values (p_commande, null, 'encaisse', p_par, null);
  return true;
end;
$$;

-- ---------- Réglages du service ----------

-- Pause (jusqu'à une heure, ou null pour reprendre), livraison fermée, délai de préparation du moment.
-- Seules ces trois clés sont modifiables depuis la tablette.
create function regler_service(p jsonb, p_personnel uuid) returns void
language plpgsql as $$
begin
  if p ? 'pause_jusqu_a' then
    update reglages set valeur = coalesce(p -> 'pause_jusqu_a', 'null'::jsonb) where cle = 'pause_jusqu_a';
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

-- Rupture d'un plat pour la journée (p_rupture vrai) ou retour à la carte.
create function regler_rupture(p_slug text, p_rupture boolean, p_personnel uuid) returns boolean
language plpgsql as $$
begin
  update plats set rupture_jour = case when p_rupture then (now() at time zone 'Europe/Zurich')::date end where slug = p_slug;
  if not found then
    return false;
  end if;
  insert into journal_personnel (personnel_id, evenement) values (p_personnel, 'rupture ' || p_slug || ' ' || p_rupture::text);
  return true;
end;
$$;

-- Plats pour l'onglet des ruptures : nom, catégorie et rupture du jour.
create function plats_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'nom', p.nom, 'categorie', c.nom,
    'rupture', p.rupture_jour = (now() at time zone 'Europe/Zurich')::date
  ) order by c.ordre, p.ordre), '[]'::jsonb)
  from plats p join categories c on c.id = p.categorie_id
  where p.commandable;
$$;

revoke execute on function
  demander_code_personnel(text, text, text, text, text), verifier_code_personnel(text, text, text, text, text, text, text),
  personnel_de_session(text), deconnecter_personnel(text, text), file_tablette(),
  changer_statut(uuid, text, text, timestamptz, text), changer_heure(uuid, timestamptz, text), marquer_encaisse(uuid, text),
  regler_service(jsonb, uuid), regler_rupture(text, boolean, uuid), plats_tablette()
  from public, anon, authenticated;
grant execute on function
  demander_code_personnel(text, text, text, text, text), verifier_code_personnel(text, text, text, text, text, text, text),
  personnel_de_session(text), deconnecter_personnel(text, text), file_tablette(),
  changer_statut(uuid, text, text, timestamptz, text), changer_heure(uuid, timestamptz, text), marquer_encaisse(uuid, text),
  regler_service(jsonb, uuid), regler_rupture(text, boolean, uuid), plats_tablette()
  to service_role;
grant select, insert, update, delete on personnel, sessions_personnel, evenements_commande, journal_personnel to service_role;
grant usage on all sequences in schema public to service_role;
