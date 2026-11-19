-- Vague 3, client-compte : alertes d'abus du parrainage et suspension d'un parrain (décision de Jérémy du 19.11.2026 :
-- pas de vérification par SMS, on allume le parrainage et on surveille les abus par des alertes au gérant).
--
-- Cas signalés, chacun une seule fois (alertes_parrainage.cle unique), envoyés par le circuit d'alertes existant
-- (e-mail des alertes, type « parrainage_abus » réglable) et visibles à l'accueil du back-office et dans la rubrique
-- Parrainages :
-- - trop_de_filleuls : un parrain qui dépasse N filleuls crédités en 30 jours (3) ;
-- - meme_adresse, meme_ip, meme_nom : des filleuls d'un même parrain qui partagent une adresse de livraison, un extrait
--   d'IP de connexion (journal_connexions.ip_court, déjà gardé pour la sécurité des comptes) ou un même nom ;
-- - sans_suite : au moins N filleuls crédités depuis plus de 30 jours, dont au moins X % n'ont jamais recommandé ;
-- - recu_plus_que_paye : un compte qui a reçu plus en parrainage qu'il n'a payé sur 30 jours.
-- L'appareil n'est pas comparé : la base n'en garde qu'un libellé générique (« Safari sur iPhone »).
--
-- Suspendre un parrain (gérant, motif obligatoire, journalisé) bloque ses nouveaux filleuls et ses nouveaux crédits,
-- sans toucher aux crédits déjà versés. Réactivable.
--
-- Objets recréés, de client-compte (20261216190000_parrainage_sur.sql) : lier_parrainage, crediter_parrainage.
-- Ajouts : quatre réglages, un type d'alerte (types_alertes, bo-operations, prévu pour ça).

insert into reglages (cle, valeur, proposition) values
  ('parrainage_alerte_filleuls_30j', '3', false),
  ('parrainage_alerte_sans_suite_min', '3', true),
  ('parrainage_alerte_sans_suite_pourcent', '75', true)
  on conflict (cle) do nothing;

insert into types_alertes (cle, libelle, aide, ordre) values
  ('parrainage_abus', 'Parrainage à surveiller', 'Trop de filleuls, filleuls qui se ressemblent, cagnotte reçue au-dessus de ce qui est payé. Détail dans la rubrique Parrainages.', 95)
  on conflict (cle) do nothing;

create table parrains_suspendus (
  parrain_id uuid primary key references comptes (id) on delete cascade,
  motif text not null check (length(motif) between 3 and 200),
  par text not null,
  le timestamptz not null default now()
);
alter table parrains_suspendus enable row level security;
revoke all on parrains_suspendus from anon, authenticated;
grant select, insert, delete on parrains_suspendus to service_role;

create table alertes_parrainage (
  id bigint generated always as identity primary key,
  cle text not null unique,
  compte_id uuid not null references comptes (id) on delete cascade,
  type text not null check (type in ('trop_de_filleuls', 'meme_adresse', 'meme_ip', 'meme_nom', 'sans_suite', 'recu_plus_que_paye')),
  detail jsonb not null default '{}'::jsonb,
  cree_le timestamptz not null default now(),
  envoye_le timestamptz,
  classee_le timestamptz,
  classee_par text
);
create index alertes_parrainage_compte_idx on alertes_parrainage (compte_id);
create index alertes_parrainage_ouvertes_idx on alertes_parrainage (cree_le) where classee_le is null;
alter table alertes_parrainage enable row level security;
revoke all on alertes_parrainage from anon, authenticated;
grant select, insert, update on alertes_parrainage to service_role;

create or replace function lier_parrainage(p_email text, p_code text) returns text
language plpgsql as $$
declare
  f comptes%rowtype;
  parrain uuid;
  debut_mois timestamptz := date_trunc('month', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
begin
  if not parrainage_actif() then
    return 'desactive';
  end if;
  select id into parrain from comptes where code_parrainage = upper(btrim(coalesce(p_code, '')));
  if parrain is null then
    return 'code';
  end if;
  select * into f from comptes where email = lower(btrim(coalesce(p_email, ''))) for update;
  if not found then
    return 'code';
  end if;
  if f.id = parrain then
    return 'soi_meme';
  end if;
  -- Parrain qualifié (relecture #260) : au moins une commande remise, payée et au minimum. Un faux compte qui n'a
  -- commandé qu'une eau à CHF 3 ne recrute personne : la chaîne de faux filleuls est cassée.
  if not parrain_qualifie(parrain) then
    return 'parrain_non_qualifie';
  end if;
  -- Parrain suspendu par le gérant (20261217090000) : plus de nouveau filleul.
  if exists (select 1 from parrains_suspendus s where s.parrain_id = parrain) then
    return 'parrain_suspendu';
  end if;
  if exists (select 1 from parrainages where filleul_id = f.id) then
    return 'deja';
  end if;
  -- Client nouveau : compte de moins de 24 heures, aucune commande avec ce compte ni avec cet e-mail (Gmail sans
  -- points, sans « +étiquette »), aucun autre compte sur la même boîte.
  if f.cree_le < now() - interval '24 hours'
     or exists (select 1 from commandes where compte_id = f.id)
     or exists (select 1 from commandes where email_cle(client_email) = email_cle(f.email))
     or exists (select 1 from comptes k where k.id <> f.id and email_cle(k.email) = email_cle(f.email)) then
    return 'ancien';
  end if;
  perform 1 from comptes where id = parrain for update;
  if (select count(*) from parrainages where parrain_id = parrain and cree_le >= debut_mois)
     >= greatest(fidelite_entier('parrainage_plafond_mois', 10), 0) then
    return 'plafond';
  end if;
  insert into parrainages (parrain_id, filleul_id) values (parrain, f.id);
  return 'ok';
end;
$$;

create or replace function crediter_parrainage(p_commande uuid) returns text
language plpgsql as $$
declare
  o commandes%rowtype;
  p parrainages%rowtype;
  tels text[];
  adr text;
  montant integer := greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0);
  v_raison text;
begin
  select * into o from commandes where id = p_commande;
  if not found or o.statut <> 'terminee' or o.compte_id is null
     or o.motif is not distinct from 'Client absent à la livraison.' or not parrainage_actif() then
    return null;
  end if;
  select * into p from parrainages where filleul_id = o.compte_id and statut = 'en_attente' for update;
  if not found then
    return null;
  end if;
  -- Téléphones de la commande : le client et la personne qui reçoit (revue de sécurité).
  tels := array_remove(array[tel_cle(o.client_telephone), tel_cle(o.destinataire ->> 'telephone')], '');
  adr := case when o.mode = 'livraison' then adresse_cle(o.adresse) end;
  -- Pas encore encaissée (comptoir) : on attend l'encaissement, qui rappelle cette fonction. Remboursée : refus.
  if o.statut_paiement in ('a_encaisser_retrait', 'en_attente') then
    return null;
  end if;
  -- Parrain suspendu par le gérant : pas de nouveau crédit, ni pour lui ni pour le filleul. Les anciens restent.
  if exists (select 1 from parrains_suspendus s where s.parrain_id = p.parrain_id) then
    v_raison := 'parrain_suspendu';
  elsif o.statut_paiement not in ('paye', 'encaisse')
     or exists (select 1 from remboursements r where r.commande_id = o.id and r.statut in ('en_cours', 'fait')) then
    v_raison := 'paiement';
  elsif cardinality(tels) > 0 and (
       exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id
               and x.statut not in ('paiement_en_attente', 'annulee')
               and (tel_cle(x.client_telephone) = any(tels) or tel_cle(x.destinataire ->> 'telephone') = any(tels)))
       or exists (select 1 from comptes k where k.id = p.parrain_id and tel_cle(k.telephone) = any(tels))) then
    v_raison := 'telephone';
  elsif adr is not null and exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id and x.mode = 'livraison'
               and adresse_cle(x.adresse) = adr and x.statut not in ('paiement_en_attente', 'annulee')) then
    v_raison := 'adresse';
  end if;
  -- Sous le minimum de plats nets (relecture #260) : rien, le parrainage attend la commande suivante. Le rattachement
  -- n'est possible qu'avant toute commande (lier_parrainage), une commande suivante ne contourne donc rien.
  if v_raison is null and base_cagnotte(o) < parrainage_minimum() then
    return null;
  end if;
  if v_raison is not null then
    update parrainages set statut = 'refuse', raison = v_raison, commande_id = o.id, termine_le = now() where id = p.id;
    return v_raison;
  end if;
  update parrainages set statut = 'credite', commande_id = o.id, termine_le = now() where id = p.id;
  if montant > 0 then
    insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
      values (p.parrain_id, o.id, 'parrainage', montant, 'Parrainage d''un proche'),
             (o.compte_id, o.id, 'parrainage', montant, 'Bienvenue par parrainage');
  end if;
  return 'credite';
end;
$$;

-- Nom comparable : prénom et nom, en minuscules, espaces réduits.
create function nom_cle(p_prenom text, p_nom text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(p_prenom, '') || ' ' || coalesce(p_nom, ''), '\s+', ' ', 'g')));
$$;

-- Détecte les cas nouveaux et les note (une seule fois par cas). Rend les cas pas encore envoyés, nouveaux ou en
-- échec d'envoi : [{ id, type, compte_id, detail }]. Le serveur les envoie, puis noter_alerte_parrainage_envoyee.
-- detail ne garde que des nombres : ni adresse, ni nom, ni e-mail de client (la clé n'en garde qu'une empreinte md5),
-- pour que l'effacement des données d'un client ne laisse rien ici.
create function detecter_alertes_parrainage() returns jsonb
language plpgsql as $$
declare
  seuil_filleuls integer := greatest(fidelite_entier('parrainage_alerte_filleuls_30j', 3), 1);
  min_suite integer := greatest(fidelite_entier('parrainage_alerte_sans_suite_min', 3), 1);
  pct_suite integer := least(greatest(fidelite_entier('parrainage_alerte_sans_suite_pourcent', 75), 1), 100);
  mois text := to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM');
begin
  -- Trop de filleuls crédités en 30 jours.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'trop_de_filleuls:' || p.parrain_id || ':' || mois, p.parrain_id, 'trop_de_filleuls', jsonb_build_object('filleuls_30j', count(*), 'seuil', seuil_filleuls)
  from parrainages p where p.statut = 'credite' and p.termine_le >= now() - interval '30 days'
  group by p.parrain_id having count(*) > seuil_filleuls
  on conflict (cle) do nothing;

  -- Filleuls d'un même parrain à la même adresse de livraison.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'meme_adresse:' || x.parrain_id || ':' || md5(x.adr), x.parrain_id, 'meme_adresse', jsonb_build_object('filleuls', x.n)
  from (
    select p.parrain_id, adresse_cle(o.adresse) as adr, count(distinct p.filleul_id) as n
    from parrainages p join commandes o on o.compte_id = p.filleul_id and o.mode = 'livraison'
    where o.statut not in ('paiement_en_attente', 'annulee') and adresse_cle(o.adresse) is not null
    group by p.parrain_id, adresse_cle(o.adresse) having count(distinct p.filleul_id) >= 2
  ) x
  on conflict (cle) do nothing;

  -- Filleuls d'un même parrain connectés depuis la même adresse IP (extrait chiffré du journal des connexions).
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'meme_ip:' || x.parrain_id || ':' || x.ip_court, x.parrain_id, 'meme_ip', jsonb_build_object('filleuls', x.n)
  from (
    select p.parrain_id, j.ip_court, count(distinct p.filleul_id) as n
    from parrainages p join journal_connexions j on j.compte_id = p.filleul_id
    where j.ip_court is not null and j.ip_court <> ''
    group by p.parrain_id, j.ip_court having count(distinct p.filleul_id) >= 2
  ) x
  on conflict (cle) do nothing;

  -- Filleuls d'un même parrain au même nom (compte ou commande).
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'meme_nom:' || x.parrain_id || ':' || md5(x.nom), x.parrain_id, 'meme_nom', jsonb_build_object('filleuls', x.n)
  from (
    select y.parrain_id, y.nom, count(distinct y.filleul_id) as n
    from (
      select p.parrain_id, p.filleul_id, nom_cle(o.client_prenom, o.client_nom) as nom
      from parrainages p join commandes o on o.compte_id = p.filleul_id
      union
      select p.parrain_id, p.filleul_id, nom_cle(k.prenom, k.nom)
      from parrainages p join comptes k on k.id = p.filleul_id
    ) y
    where length(y.nom) >= 3
    group by y.parrain_id, y.nom having count(distinct y.filleul_id) >= 2
  ) x
  on conflict (cle) do nothing;

  -- Filleuls crédités depuis plus de 30 jours qui n'ont jamais recommandé.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'sans_suite:' || x.parrain_id || ':' || mois, x.parrain_id, 'sans_suite',
         jsonb_build_object('filleuls', x.total, 'sans_suite', x.sans_suite, 'pourcent', round(100.0 * x.sans_suite / x.total))
  from (
    select p.parrain_id, count(*) as total,
           count(*) filter (where (select count(*) from commandes o where o.compte_id = p.filleul_id and o.statut = 'terminee') < 2) as sans_suite
    from parrainages p where p.statut = 'credite' and p.termine_le < now() - interval '30 days'
    group by p.parrain_id
  ) x
  where x.total >= min_suite and 100 * x.sans_suite >= pct_suite * x.total
  on conflict (cle) do nothing;

  -- Compte qui a reçu plus en parrainage qu'il n'a payé sur 30 jours.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'recu_plus_que_paye:' || x.compte_id || ':' || mois, x.compte_id, 'recu_plus_que_paye',
         jsonb_build_object('recu_centimes', x.recu, 'paye_centimes', x.paye)
  from (
    select m.compte_id, sum(m.montant_centimes)::integer as recu,
           coalesce((select sum(o.total_centimes) from commandes o where o.compte_id = m.compte_id and o.statut = 'terminee'
                     and o.statut_paiement in ('paye', 'encaisse') and o.cree_le >= now() - interval '30 days'), 0)::integer as paye
    from cagnotte_mouvements m where m.type = 'parrainage' and m.cree_le >= now() - interval '30 days'
    group by m.compte_id
  ) x
  where x.recu > x.paye
  on conflict (cle) do nothing;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'compte_id', a.compte_id, 'detail', a.detail) order by a.id)
    from alertes_parrainage a where a.envoye_le is null
  ), '[]'::jsonb);
end;
$$;

create function noter_alerte_parrainage_envoyee(p_id bigint) returns void
language sql as $$
  update alertes_parrainage set envoye_le = now() where id = p_id and envoye_le is null;
$$;

-- Le gérant classe un signal examiné : il quitte l'accueil, reste dans la rubrique Parrainages.
create function classer_alerte_parrainage(p_id bigint, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
begin
  update alertes_parrainage set classee_le = now(), classee_par = auteur where id = p_id and classee_le is null;
  return found;
end;
$$;

create function suspendre_parrain(p_compte uuid, p_motif text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  m text := btrim(coalesce(p_motif, ''));
begin
  if length(m) not between 3 and 200 then
    raise exception 'suspension_refusee:motif';
  end if;
  if not exists (select 1 from comptes where id = p_compte) then
    raise exception 'suspension_refusee:compte';
  end if;
  insert into parrains_suspendus (parrain_id, motif, par) values (p_compte, m, auteur)
    on conflict (parrain_id) do update set motif = excluded.motif, par = excluded.par, le = now();
  perform journaliser(p_personnel, 'parrainage', p_compte::text, null, jsonb_build_object('suspendu', true, 'motif', m));
  return true;
end;
$$;

create function reactiver_parrain(p_compte uuid, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant parrains_suspendus%rowtype;
begin
  delete from parrains_suspendus where parrain_id = p_compte returning * into avant;
  if not found then
    return false;
  end if;
  perform journaliser(p_personnel, 'parrainage', p_compte::text, jsonb_build_object('suspendu', true, 'motif', avant.motif),
    jsonb_build_object('suspendu', false));
  return true;
end;
$$;

-- Rubrique Parrainages : chaque parrain, ses filleuls (dates, montants, statut), ses signaux et sa suspension. Les
-- parrains avec un signal ouvert d'abord.
create function parrainages_gestion() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.ligne order by x.ouverts desc, x.dernier desc), '[]'::jsonb)
  from (
    select
      (select count(*) from alertes_parrainage a where a.classee_le is null
         and (a.compte_id = k.id or a.compte_id in (select filleul_id from parrainages where parrain_id = k.id))) as ouverts,
      (select max(cree_le) from parrainages where parrain_id = k.id) as dernier,
      jsonb_build_object(
        'parrain_id', k.id,
        'email', k.email,
        'prenom', k.prenom,
        'nom', k.nom,
        'suspendu', (select jsonb_build_object('motif', s.motif, 'par', s.par, 'le', s.le) from parrains_suspendus s where s.parrain_id = k.id),
        'filleuls', coalesce((
          select jsonb_agg(jsonb_build_object(
            'email', f.email, 'prenom', f.prenom, 'nom', f.nom, 'lie_le', p.cree_le, 'statut', p.statut, 'raison', p.raison,
            'termine_le', p.termine_le,
            'montant_centimes', coalesce((select sum(m.montant_centimes) from cagnotte_mouvements m
                                          where m.compte_id = f.id and m.type = 'parrainage'), 0)
          ) order by p.cree_le)
          from parrainages p join comptes f on f.id = p.filleul_id where p.parrain_id = k.id
        ), '[]'::jsonb),
        'signaux', coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'detail', a.detail, 'le', a.cree_le,
            'classee_le', a.classee_le, 'filleul', a.compte_id <> k.id) order by a.cree_le desc)
          from alertes_parrainage a
          where a.compte_id = k.id or a.compte_id in (select filleul_id from parrainages where parrain_id = k.id)
        ), '[]'::jsonb)
      ) as ligne
    from comptes k
    where exists (select 1 from parrainages p where p.parrain_id = k.id)
  ) x;
$$;

-- Accueil du back-office : nombre de signaux pas encore classés.
create function signaux_parrainage_ouverts() returns integer
language sql stable as $$
  select count(*)::integer from alertes_parrainage where classee_le is null;
$$;

revoke execute on function nom_cle(text, text), detecter_alertes_parrainage(), noter_alerte_parrainage_envoyee(bigint),
  classer_alerte_parrainage(bigint, uuid), suspendre_parrain(uuid, text, uuid), reactiver_parrain(uuid, uuid),
  parrainages_gestion(), signaux_parrainage_ouverts()
  from public, anon, authenticated;
grant execute on function nom_cle(text, text), detecter_alertes_parrainage(), noter_alerte_parrainage_envoyee(bigint),
  classer_alerte_parrainage(bigint, uuid), suspendre_parrain(uuid, text, uuid), reactiver_parrain(uuid, uuid),
  parrainages_gestion(), signaux_parrainage_ouverts()
  to service_role;
