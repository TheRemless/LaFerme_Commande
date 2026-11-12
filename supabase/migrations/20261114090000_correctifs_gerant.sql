-- Correctifs de l'audit « journée du gérant » (docs/audits/gerant.md) :
--   G03 l'équipe gérée dans le back-office ;
--   G02 remboursement après coup, total ou partiel, et export comptable qui le retire des ventes ;
--   G04 commandes passées : liste, recherche, compte par jour ;
--   G05 retard du soir, ajouté au retrait et à la livraison ;
--   G06 remise à zéro chaque nuit (livraison fermée, pause sans fin, retard) ;
--   créneaux pleins lus par l'accueil pour ne plus les proposer, sans donnée personnelle (SS-02 côté client).
-- Toutes les fonctions sont réservées au rôle service_role (le serveur du site).

alter table journal_gestion drop constraint journal_gestion_objet_check;
alter table journal_gestion add constraint journal_gestion_objet_check
  check (objet in ('plat', 'option', 'retraits', 'zone', 'horaire', 'fermeture', 'import', 'imprimante', 'reglage', 'personnel', 'remboursement'));

-- ---------- G03 : l'équipe ----------

create function liste_personnel(p_personnel uuid) returns jsonb
language plpgsql stable as $$
begin
  perform gerant_nom(p_personnel);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'nom', p.nom, 'role', p.role, 'actif', p.actif,
      'sessions', (select count(*) from sessions_personnel s where s.personnel_id = p.id and s.revoquee_le is null and s.expire_le > now()),
      'derniere_connexion', (select max(s.cree_le) from sessions_personnel s where s.personnel_id = p.id)
    ) order by p.actif desc, p.role desc, p.nom)
    from personnel p
  ), '[]'::jsonb);
end;
$$;

-- Ajoute un membre, ou réactive un membre retiré (même adresse). Renvoie son identifiant.
create function ajouter_personnel(p_email text, p_nom text, p_role text, p_personnel uuid) returns uuid
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
  if p_role not in ('service', 'gerant') then
    raise exception 'role_invalide';
  end if;
  select * into avant from personnel where email = e for update;
  if found and avant.actif then
    raise exception 'deja_membre';
  end if;
  if found then
    update personnel set nom = n, role = p_role, actif = true where id = avant.id returning id into pid;
    -- Un membre retiré à l'ancienne (actif = false en SQL) pouvait garder ses sessions : on les coupe.
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

-- Nom, rôle, actif. Retirer coupe les sessions tout de suite. Il reste toujours un gérant actif.
create function modifier_personnel(p_id uuid, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant personnel%rowtype;
  apres personnel%rowtype;
  n text;
begin
  -- Verrou sur les gérants actifs : deux retraits simultanés ne laissent pas la maison sans gérant.
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
    if p ->> 'role' not in ('service', 'gerant') then
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

-- Tablette perdue, téléphone changé : déconnecte partout sans retirer le membre.
create function couper_sessions_personnel(p_id uuid, p_personnel uuid) returns integer
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  e text;
  nb integer;
begin
  select email into e from personnel where id = p_id;
  if e is null then
    return 0;
  end if;
  update sessions_personnel set revoquee_le = now() where personnel_id = p_id and revoquee_le is null and expire_le > now();
  get diagnostics nb = row_count;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', e, null, jsonb_build_object('sessions_coupees', nb));
  return nb;
end;
$$;

-- ---------- G02 : remboursement après coup ----------

-- Un remboursement par geste du gérant. La clé vient de l'écran : un double appui renvoie la même ligne.
-- Payée en ligne : remboursement Stripe (en cours, puis fait ou échec). Au comptoir : rendu en espèces,
-- noté fait tout de suite. Seuls « en cours » et « fait » comptent dans le montant déjà remboursé.
create table remboursements (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references commandes (id) on delete cascade,
  cle text not null unique check (length(cle) between 8 and 80),
  montant_centimes integer not null check (montant_centimes > 0),
  motif text not null check (length(motif) between 3 and 200),
  moyen text not null check (moyen in ('stripe', 'especes')),
  statut text not null check (statut in ('en_cours', 'fait', 'echec')),
  stripe_refund_id text,
  erreur text,
  personnel_id uuid references personnel (id) on delete set null,
  personnel_nom text not null,
  cree_le timestamptz not null default now(),
  fait_le timestamptz
);
create index remboursements_commande_idx on remboursements (commande_id);
create index remboursements_fait_idx on remboursements (fait_le) where statut = 'fait';
alter table remboursements enable row level security;
revoke all on remboursements from anon, authenticated;
grant select, insert, update on remboursements to service_role;

-- La commande passe « remboursée » quand le total est rendu.
create function maj_rembourse(p_commande uuid) returns void
language sql as $$
  update commandes c set statut_paiement = 'rembourse', rembourse_le = now()
  where c.id = p_commande and c.statut_paiement in ('paye', 'encaisse')
    and (select coalesce(sum(r.montant_centimes), 0) from remboursements r where r.commande_id = c.id and r.statut = 'fait') >= c.total_centimes;
$$;

create function demander_remboursement(p_commande uuid, p_montant integer, p_motif text, p_cle text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  m text := btrim(regexp_replace(coalesce(p_motif, ''), '\s+', ' ', 'g'));
  c commandes%rowtype;
  r remboursements%rowtype;
  engage integer;
begin
  if p_cle is null or length(p_cle) not between 8 and 80 then
    raise exception 'cle_invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('remboursement:' || p_cle));
  select * into r from remboursements where cle = p_cle;
  if found then
    if r.commande_id <> p_commande or r.montant_centimes <> p_montant then
      raise exception 'cle_reutilisee';
    end if;
    return to_jsonb(r) || jsonb_build_object('deja', true, 'numero', (select numero from commandes where id = p_commande));
  end if;
  if length(m) not between 3 and 200 then
    raise exception 'motif_invalide';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant_invalide';
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    raise exception 'commande_inconnue';
  end if;
  if c.statut not in ('prete', 'partie', 'terminee') then
    raise exception 'statut_non_remboursable';
  end if;
  if c.statut_paiement not in ('paye', 'encaisse') then
    raise exception 'pas_encaissee';
  end if;
  if c.moyen_paiement = 'en_ligne' and c.stripe_payment_intent is null then
    raise exception 'sans_paiement_en_ligne';
  end if;
  select coalesce(sum(montant_centimes), 0) into engage from remboursements where commande_id = p_commande and statut in ('en_cours', 'fait');
  if engage + p_montant > c.total_centimes then
    raise exception 'montant_trop_eleve';
  end if;
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le)
  values (p_commande, p_cle, p_montant, m,
    case when c.moyen_paiement = 'en_ligne' then 'stripe' else 'especes' end,
    case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
    p_personnel, auteur,
    case when c.moyen_paiement = 'en_ligne' then null else now() end)
  returning * into r;
  insert into evenements_commande (commande_id, de, vers, par, detail)
  values (p_commande, null, 'remboursement', 'gestion:' || auteur, (p_montant / 100.0)::numeric(10, 2)::text || ' CHF, ' || m);
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'remboursement', c.numero::text, null,
    jsonb_build_object('commande', c.id, 'jour', c.jour_service, 'montant_centimes', p_montant, 'motif', m, 'moyen', r.moyen));
  if r.statut = 'fait' then
    perform maj_rembourse(p_commande);
  end if;
  return to_jsonb(r) || jsonb_build_object('deja', false, 'numero', c.numero);
end;
$$;

-- Résultat de l'appel à Stripe. Ne change qu'un remboursement encore « en cours ».
create function terminer_remboursement(p_id uuid, p_ok boolean, p_refund_id text, p_erreur text) returns jsonb
language plpgsql as $$
declare
  r remboursements%rowtype;
begin
  update remboursements set
    statut = case when p_ok then 'fait' else 'echec' end,
    stripe_refund_id = coalesce(p_refund_id, stripe_refund_id),
    erreur = case when p_ok then null else left(p_erreur, 300) end,
    fait_le = case when p_ok then now() else null end
  where id = p_id and statut = 'en_cours'
  returning * into r;
  if not found then
    select * into r from remboursements where id = p_id;
    return to_jsonb(r) || jsonb_build_object('change', false);
  end if;
  if p_ok then
    perform maj_rembourse(r.commande_id);
  end if;
  return to_jsonb(r) || jsonb_build_object('change', true);
end;
$$;

-- Ventes : une commande remboursée après coup reste une vente ; son remboursement la diminue à sa date
-- (export_remboursements). Une commande refusée ou annulée n'a jamais été une vente.
create or replace function export_ventes(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', o.jour, 'numero', o.numero, 'heure', to_char(o.cree_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'mode', o.mode, 'paiement', case when o.statut_paiement = 'paye' or (o.statut_paiement = 'rembourse' and o.moyen_paiement = 'en_ligne') then 'en ligne' else 'comptoir' end,
    'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
    'taux_tva_pourcent', o.taux_tva_pourcent, 'tva_centimes', o.tva_centimes, 'stripe_payment_intent', o.stripe_payment_intent
  ) order by o.jour, o.numero), '[]'::jsonb)
  from commandes o
  where o.jour between p_debut and p_fin
    and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
    and o.statut not in ('refusee', 'annulee');
$$;

create function export_remboursements(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', (r.fait_le at time zone 'Europe/Zurich')::date, 'heure', to_char(r.fait_le at time zone 'Europe/Zurich', 'HH24:MI'),
    'numero', o.numero, 'jour_vente', o.jour, 'mode', o.mode,
    'paiement', case when r.moyen = 'stripe' then 'en ligne' else 'comptoir' end,
    'montant_centimes', r.montant_centimes, 'taux_tva_pourcent', o.taux_tva_pourcent,
    'tva_centimes', round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer,
    'reference', r.stripe_refund_id
  ) order by r.fait_le), '[]'::jsonb)
  from remboursements r join commandes o on o.id = r.commande_id
  where r.statut = 'fait' and (r.fait_le at time zone 'Europe/Zurich')::date between p_debut and p_fin;
$$;

-- ---------- G04 : commandes passées ----------

-- Téléphone ramené à sa forme nationale, chiffres seulement : +41 79…, 0041 79… et 079… se comparent.
create function tel_national(t text) returns text
language sql immutable as $$
  select case
    when d like '0041%' then '0' || substr(d, 5)
    when d like '41%' and length(d) = 11 then '0' || substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x;
$$;

-- Liste pour le gérant, jour de service compris entre les bornes. Avec une recherche (numéro, nom,
-- téléphone), les bornes valent 90 jours en arrière si elles manquent. 300 lignes au plus.
create function commandes_gestion(p_debut date, p_fin date, p_recherche text) returns jsonb
language plpgsql stable as $$
declare
  q text := btrim(coalesce(p_recherche, ''));
  chiffres text := tel_national(q);
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  debut date := coalesce(p_debut, case when q = '' then aujourd_hui else aujourd_hui - 90 end);
  fin date := coalesce(p_fin, aujourd_hui + 8);
begin
  return coalesce((
    select jsonb_agg(x.j order by x.cree_le desc) from (
      select o.cree_le, jsonb_build_object(
        'id', o.id, 'numero', o.numero, 'jour_service', o.jour_service, 'cree_le', o.cree_le, 'mode', o.mode,
        'statut', o.statut, 'statut_paiement', o.statut_paiement, 'moyen_paiement', o.moyen_paiement,
        'client_prenom', o.client_prenom, 'client_nom', o.client_nom, 'client_telephone', o.client_telephone,
        'total_centimes', o.total_centimes,
        'rembourse_centimes', (select coalesce(sum(r.montant_centimes), 0) from remboursements r where r.commande_id = o.id and r.statut = 'fait')
      ) as j
      from commandes o
      where o.statut not in ('paiement_en_attente', 'annulee')
        and o.jour_service between debut and fin
        and (
          q = ''
          or (q ~ '^\d{1,4}$' and o.numero = q::integer)
          or (length(chiffres) >= 4 and tel_national(o.client_telephone) like '%' || chiffres || '%')
          or (q !~ '^\d' and (o.client_prenom || ' ' || o.client_nom) ilike '%' || q || '%')
        )
      order by o.cree_le desc
      limit 300
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Par jour de service : commandes servies, refusées, ventes, remboursé, comptoir pas encore encaissé.
create function jours_gestion(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', j.jour, 'commandes', j.commandes, 'refusees', j.refusees, 'ventes_centimes', j.ventes,
    'rembourse_centimes', j.rembourse, 'a_encaisser', j.a_encaisser
  ) order by j.jour desc), '[]'::jsonb)
  from (
    select o.jour_service as jour,
      count(*) filter (where o.statut not in ('refusee', 'annulee')) as commandes,
      count(*) filter (where o.statut = 'refusee') as refusees,
      coalesce(sum(o.total_centimes) filter (where o.statut not in ('refusee', 'annulee') and o.statut_paiement in ('paye', 'encaisse', 'rembourse')), 0) as ventes,
      coalesce(sum((select coalesce(sum(r.montant_centimes), 0) from remboursements r where r.commande_id = o.id and r.statut = 'fait')) filter (where o.statut not in ('refusee', 'annulee')), 0) as rembourse,
      count(*) filter (where o.statut_paiement = 'a_encaisser_retrait' and o.statut not in ('refusee', 'annulee')) as a_encaisser
    from commandes o
    where o.jour_service between p_debut and p_fin and o.statut not in ('paiement_en_attente', 'annulee')
    group by o.jour_service
  ) j;
$$;

create function commande_gestion(p_id uuid) returns jsonb
language sql stable as $$
  select commande_par_id(p_id) || jsonb_build_object(
    'evenements', coalesce((select jsonb_agg(jsonb_build_object('de', e.de, 'vers', e.vers, 'par', e.par, 'detail', e.detail, 'le', e.le) order by e.le, e.id)
      from evenements_commande e where e.commande_id = p_id), '[]'::jsonb),
    'remboursements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'cle', r.cle, 'montant_centimes', r.montant_centimes, 'motif', r.motif, 'moyen', r.moyen, 'statut', r.statut,
        'erreur', r.erreur, 'personnel_nom', r.personnel_nom, 'cree_le', r.cree_le, 'fait_le', r.fait_le) order by r.cree_le)
      from remboursements r where r.commande_id = p_id), '[]'::jsonb),
    'rembourse_centimes', (select coalesce(sum(r.montant_centimes), 0) from remboursements r where r.commande_id = p_id and r.statut = 'fait')
  )
  where exists (select 1 from commandes where id = p_id);
$$;

-- ---------- G05 et G06 : retard du soir, remise à zéro chaque nuit ----------

-- Le jour de service change à 5h du matin, heure de Genève (un service ne finit jamais après).
-- La première remise après l'installation attend le jour suivant : rien ne bouge en plein service.
insert into reglages (cle, valeur, proposition) values
  ('retard_minutes', '0', false),
  ('remise_jour', to_jsonb((((now() at time zone 'Europe/Zurich') - interval '5 hours')::date)::text), false)
on conflict (cle) do nothing;

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
  if p ? 'retard_minutes' then
    if (p ->> 'retard_minutes')::integer not between 0 and 90 then
      raise exception 'Retard hors limites';
    end if;
    update reglages set valeur = to_jsonb((p ->> 'retard_minutes')::integer) where cle = 'retard_minutes';
  end if;
  insert into journal_personnel (personnel_id, evenement) values (p_personnel, 'reglages ' || p::text);
end;
$$;

-- Appelée par la surveillance (chaque minute). Au premier passage d'un nouveau jour de service :
-- livraison rouverte, retard à zéro, pause manuelle sans fin levée. Une pause automatique (tablette
-- muette) reste : quelqu'un doit la lever en regardant la tablette. Renvoie ce qui a été remis, ou null.
create function remise_du_jour() returns jsonb
language plpgsql as $$
declare
  jour text := (((now() at time zone 'Europe/Zurich') - interval '5 hours')::date)::text;
  derniere jsonb;
  avant jsonb;
begin
  select valeur into derniere from reglages where cle = 'remise_jour' for update;
  if derniere = to_jsonb(jour) then
    return null;
  end if;
  select jsonb_object_agg(cle, valeur) into avant from reglages
    where cle in ('livraison_fermee', 'retard_minutes', 'pause_jusqu_a', 'pause_auto');
  update reglages set valeur = 'false'::jsonb where cle = 'livraison_fermee' and valeur <> 'false'::jsonb;
  update reglages set valeur = '0'::jsonb where cle = 'retard_minutes' and valeur <> '0'::jsonb;
  update reglages set valeur = 'null'::jsonb
    where cle = 'pause_jusqu_a' and valeur <> 'null'::jsonb
      and coalesce((select r.valeur from reglages r where r.cle = 'pause_auto'), 'false'::jsonb) <> 'true'::jsonb;
  insert into reglages (cle, valeur, proposition) values ('remise_jour', to_jsonb(jour), false)
    on conflict (cle) do update set valeur = excluded.valeur;
  insert into journal_personnel (personnel_id, evenement) values (null, 'remise du jour ' || avant::text);
  return avant;
end;
$$;

-- ---------- Créneaux pleins, pour ne plus les proposer au client ----------
-- Lue à chaque affichage de l'accueil : un index évite de parcourir toutes les commandes.
create index commandes_creneau_idx on commandes (quand_date, mode, quand_minutes) where quand_type = 'creneau';

-- Créneaux pleins entre deux dates, par mode (même règle que creneau_plein, SS-02). Aucune donnée de client.
create function creneaux_pleins(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', x.d, 'mode', x.mode, 'minutes', x.m) order by x.d, x.mode, x.m), '[]'::jsonb)
  from (
    select distinct c.quand_date as d, c.mode, c.quand_minutes as m from commandes c
    where c.quand_type = 'creneau' and c.quand_date between p_debut and p_fin and c.statut not in ('refusee', 'annulee')
  ) x
  where creneau_plein(x.d, x.m, x.mode);
$$;

revoke execute on function
  liste_personnel(uuid), ajouter_personnel(text, text, text, uuid), modifier_personnel(uuid, jsonb, uuid),
  couper_sessions_personnel(uuid, uuid), maj_rembourse(uuid),
  demander_remboursement(uuid, integer, text, text, uuid), terminer_remboursement(uuid, boolean, text, text),
  export_remboursements(date, date), commandes_gestion(date, date, text), jours_gestion(date, date),
  commande_gestion(uuid), remise_du_jour(), creneaux_pleins(date, date), tel_national(text)
  from public, anon, authenticated;
grant execute on function
  liste_personnel(uuid), ajouter_personnel(text, text, text, uuid), modifier_personnel(uuid, jsonb, uuid),
  couper_sessions_personnel(uuid, uuid), maj_rembourse(uuid),
  demander_remboursement(uuid, integer, text, text, uuid), terminer_remboursement(uuid, boolean, text, text),
  export_remboursements(date, date), commandes_gestion(date, date, text), jours_gestion(date, date),
  commande_gestion(uuid), remise_du_jour(), creneaux_pleins(date, date), tel_national(text)
  to service_role;
