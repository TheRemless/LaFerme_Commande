-- Lot 6 : comptes clients, connexion par code e-mail à 6 chiffres.
-- Connexion faite par le site, pas par Supabase Auth (écart au prompt décidé le 6.11.2026, voir docs/PROMPT.md §4).
--
-- Même modèle que les commandes : sécurité par ligne activée sans aucune politique, droits retirés à anon et
-- authenticated, tout passe par les fonctions ci-dessous, réservées au serveur (clé secrète). Le serveur ne leur
-- passe que l'identifiant du compte tiré d'une session vérifiée : un visiteur ne peut lire que son propre compte.
--
-- Rien de secret n'est gardé en clair : codes, jetons de session, adresses IP et e-mails servant aux limites
-- sont des empreintes HMAC-SHA-256 calculées par le serveur (64 caractères hexadécimaux).

create table comptes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) between 5 and 120),
  prenom text not null default '',
  nom text not null default '',
  telephone text not null default '',
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

-- Un seul code valable à la fois par e-mail : un nouveau code annule le précédent.
create table codes_connexion (
  id uuid primary key default gen_random_uuid(),
  cle_email text not null,
  code_hache text not null,
  essais smallint not null default 0,
  -- Délai croissant entre deux essais faux sur le même code.
  prochain_essai_le timestamptz not null default now(),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  utilise_le timestamptz,
  invalide_le timestamptz
);
create index codes_connexion_email_idx on codes_connexion (cle_email, cree_le desc);

create table sessions_compte (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes (id) on delete cascade,
  jeton_hache text not null unique,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  revoquee_le timestamptz
);
create index sessions_compte_compte_idx on sessions_compte (compte_id);

create table adresses_compte (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes (id) on delete cascade,
  -- Bâtiment du registre fédéral, sinon rue, numéro et NPA : la même adresse n'est gardée qu'une fois.
  cle text not null,
  adresse jsonb not null,
  details jsonb not null default '{}',
  utilisee_le timestamptz not null default now(),
  unique (compte_id, cle)
);

-- Compteurs des limites de débit, par empreinte d'e-mail ou d'adresse IP. Gardés un jour.
create table tentatives_connexion (
  id bigint generated always as identity primary key,
  action text not null check (action in ('envoi_email', 'envoi_ip', 'echec_ip')),
  cle text not null,
  le timestamptz not null default now()
);
create index tentatives_connexion_idx on tentatives_connexion (action, cle, le desc);

-- Journal des connexions : événement, date, début de l'empreinte de l'IP. Ni e-mail, ni code, ni jeton.
create table journal_connexions (
  id bigint generated always as identity primary key,
  compte_id uuid references comptes (id) on delete cascade,
  evenement text not null check (evenement in (
    'code_demande', 'code_limite', 'connexion', 'echec_code', 'deconnexion', 'deconnexion_partout',
    'profil_modifie', 'adresse_supprimee', 'export', 'compte_supprime'
  )),
  ip_court text,
  le timestamptz not null default now()
);
create index journal_connexions_compte_idx on journal_connexions (compte_id, le desc);

alter table commandes add column compte_id uuid references comptes (id) on delete set null;
-- Case « créer mon compte » cochée en fin de commande : le suivi propose d'entrer le code reçu.
alter table commandes add column compte_demande boolean not null default false;
create index commandes_compte_idx on commandes (compte_id, cree_le desc);

create trigger comptes_modifie_le before update on comptes
  for each row execute function maj_modifie_le();

alter table comptes enable row level security;
alter table codes_connexion enable row level security;
alter table sessions_compte enable row level security;
alter table adresses_compte enable row level security;
alter table tentatives_connexion enable row level security;
alter table journal_connexions enable row level security;
-- Aucune politique : sans clé secrète, rien n'est lisible ni modifiable.
revoke all on comptes, codes_connexion, sessions_compte, adresses_compte, tentatives_connexion, journal_connexions from anon, authenticated;

-- ---------- Outils ----------

-- Compare deux empreintes en parcourant toujours les 32 octets : la durée ne dit rien du contenu.
create function egal_constant(a text, b text) returns boolean
language sql immutable as $$
  select a ~ '^[0-9a-f]{64}$' and b ~ '^[0-9a-f]{64}$' and (
    select bit_or(get_byte(decode(a, 'hex'), i) # get_byte(decode(b, 'hex'), i)) from generate_series(0, 31) as i
  ) = 0;
$$;

-- Secondes à attendre avant la prochaine tentative (0 : permise). Au plus p_max tentatives par fenêtre ;
-- au-delà de p_libres tentatives, délai de p_base secondes doublé à chaque fois, plafonné à 15 minutes.
create function attente_limite(p_action text, p_cle text, p_max integer, p_fenetre interval, p_base integer, p_libres integer)
returns integer
language plpgsql as $$
declare
  n integer;
  premier timestamptz;
  dernier timestamptz;
  delai numeric;
begin
  select count(*), min(le), max(le) into n, premier, dernier
  from tentatives_connexion where action = p_action and cle = p_cle and le > now() - p_fenetre;
  if n >= p_max then
    return greatest(1, ceil(extract(epoch from (premier + p_fenetre - now())))::integer);
  end if;
  if n >= p_libres and p_base > 0 then
    delai := least(900, p_base * power(2, n - p_libres));
    return greatest(0, ceil(delai - extract(epoch from (now() - dernier)))::integer);
  end if;
  return 0;
end;
$$;

-- Garde une adresse de livraison pour le compte (dix au plus, les plus récentes).
create function enregistrer_adresse(p_compte uuid, p_adresse jsonb, p_details jsonb) returns void
language plpgsql as $$
declare
  k text := coalesce(
    nullif(p_adresse ->> 'featureId', ''),
    lower(concat_ws('|', p_adresse ->> 'rue', p_adresse ->> 'numero', p_adresse ->> 'npa'))
  );
begin
  insert into adresses_compte (compte_id, cle, adresse, details) values (p_compte, k, p_adresse, coalesce(p_details, '{}'))
    on conflict (compte_id, cle) do update set adresse = excluded.adresse, details = excluded.details, utilisee_le = now();
  delete from adresses_compte where compte_id = p_compte and id not in (
    select id from adresses_compte where compte_id = p_compte order by utilisee_le desc limit 10
  );
end;
$$;

-- Complète le profil vide avec les coordonnées d'une commande, et garde son adresse de livraison.
create function completer_depuis_commande(p_compte uuid, p_commande uuid) returns void
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  select * into c from commandes where id = p_commande and compte_id = p_compte;
  if not found then
    return;
  end if;
  update comptes set
    prenom = case when prenom = '' then c.client_prenom else prenom end,
    nom = case when nom = '' then c.client_nom else nom end,
    telephone = case when telephone = '' then c.client_telephone else telephone end
  where id = p_compte;
  if c.mode = 'livraison' and c.adresse is not null then
    perform enregistrer_adresse(p_compte, c.adresse, c.details_livraison);
  end if;
end;
$$;

-- ---------- Connexion ----------

-- Prépare un nouveau code (son empreinte arrive du serveur, qui l'envoie ensuite par e-mail).
-- Renvoie le nombre de secondes à attendre, 0 si le code est enregistré. Même réponse que le compte
-- existe ou non : on ne peut pas savoir par là qui a un compte.
create function demander_code(p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text)
returns integer
language plpgsql as $$
declare
  a integer;
  cid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  -- Ménage, une demande sur vingt : les compteurs vivent un jour, les codes un jour, le journal six mois.
  if random() < 0.05 then
    delete from tentatives_connexion where le < now() - interval '1 day';
    delete from codes_connexion where cree_le < now() - interval '1 day';
    delete from sessions_compte where expire_le < now() - interval '30 days' or revoquee_le < now() - interval '30 days';
    delete from journal_connexions where le < now() - interval '180 days';
  end if;

  select id into cid from comptes where email = p_email;
  -- Par e-mail : un code tout de suite, puis 30 s, 1 min, 2 min, 4 min d'attente, cinq par heure au plus.
  -- Par IP : vingt par heure (un réseau partagé, comme un bureau, ne doit pas bloquer trop vite).
  a := greatest(
    attente_limite('envoi_email', p_cle_email, 5, interval '1 hour', 30, 1),
    attente_limite('envoi_ip', p_cle_ip, 20, interval '1 hour', 0, 0)
  );
  if a > 0 then
    insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'code_limite', p_ip_court);
    return a;
  end if;
  insert into tentatives_connexion (action, cle) values ('envoi_email', p_cle_email), ('envoi_ip', p_cle_ip);
  update codes_connexion set invalide_le = now()
    where cle_email = p_cle_email and utilise_le is null and invalide_le is null;
  insert into codes_connexion (cle_email, code_hache, expire_le) values (p_cle_email, p_code_hache, now() + interval '10 minutes');
  insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'code_demande', p_ip_court);
  return 0;
end;
$$;

-- Vérifie un code. Bon : il est consommé, le compte est créé s'il n'existe pas, une session neuve est
-- ouverte (l'ancienne du navigateur est fermée) et la commande du lien de suivi est rattachée si elle
-- porte le même e-mail. Faux : un essai de moins (cinq au plus par code), délai croissant.
create function verifier_code(
  p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text,
  p_session_hache text, p_ancienne_session_hache text default null, p_jeton_commande text default null
) returns jsonb
language plpgsql as $$
declare
  a integer;
  k codes_connexion%rowtype;
  trouve boolean;
  cid uuid;
  v_commande uuid;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  -- Par IP : cinq essais faux libres, puis 2 s, 4 s, 8 s… et trente par heure au plus.
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

  if not trouve or not egal_constant(k.code_hache, p_code_hache) then
    insert into tentatives_connexion (action, cle) values ('echec_ip', p_cle_ip);
    if trouve then
      -- Dans SET, essais vaut encore l'ancienne valeur : 1 s, 2 s, 4 s, 8 s, puis le code est annulé.
      update codes_connexion set
        essais = essais + 1,
        prochain_essai_le = now() + make_interval(secs => power(2, essais)),
        invalide_le = case when essais + 1 >= 5 then now() else null end
      where id = k.id;
    end if;
    insert into journal_connexions (compte_id, evenement, ip_court)
      values ((select id from comptes where email = p_email), 'echec_code', p_ip_court);
    return jsonb_build_object('statut', 'invalide');
  end if;

  update codes_connexion set utilise_le = now() where id = k.id;
  insert into comptes (email) values (p_email) on conflict (email) do nothing;
  select id into cid from comptes where email = p_email;
  if p_ancienne_session_hache is not null then
    update sessions_compte set revoquee_le = now() where jeton_hache = p_ancienne_session_hache and revoquee_le is null;
  end if;
  insert into sessions_compte (compte_id, jeton_hache, expire_le) values (cid, p_session_hache, now() + interval '30 days');

  if p_jeton_commande is not null then
    update commandes set compte_id = cid
      where jeton_suivi = p_jeton_commande and client_email = p_email and compte_id is null
      returning id into v_commande;
    if v_commande is not null then
      perform completer_depuis_commande(cid, v_commande);
    end if;
  end if;
  insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'connexion', p_ip_court);
  return jsonb_build_object('statut', 'ok', 'compte_id', cid);
end;
$$;

-- Compte d'une session encore valable (ni expirée ni révoquée), sinon null.
create function compte_de_session(p_session_hache text) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', c.id, 'email', c.email, 'prenom', c.prenom, 'nom', c.nom, 'telephone', c.telephone)
  from sessions_compte s join comptes c on c.id = s.compte_id
  where s.jeton_hache = p_session_hache and s.revoquee_le is null and s.expire_le > now();
$$;

-- Déconnexion de ce navigateur, ou de tous les appareils du compte.
create function deconnecter(p_session_hache text, p_partout boolean, p_ip_court text) returns void
language plpgsql as $$
declare
  cid uuid;
begin
  select compte_id into cid from sessions_compte where jeton_hache = p_session_hache and revoquee_le is null;
  if cid is null then
    return;
  end if;
  if p_partout then
    update sessions_compte set revoquee_le = now() where compte_id = cid and revoquee_le is null;
  else
    update sessions_compte set revoquee_le = now() where jeton_hache = p_session_hache;
  end if;
  insert into journal_connexions (compte_id, evenement, ip_court)
    values (cid, case when p_partout then 'deconnexion_partout' else 'deconnexion' end, p_ip_court);
end;
$$;

-- ---------- Espace client (toujours pour le compte de la session) ----------

create function espace_compte(p_compte uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'compte', jsonb_build_object('id', c.id, 'email', c.email, 'prenom', c.prenom, 'nom', c.nom, 'telephone', c.telephone, 'cree_le', c.cree_le),
    'adresses', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'adresse', a.adresse, 'details', a.details) order by a.utilisee_le desc)
      from adresses_compte a where a.compte_id = c.id
    ), '[]'::jsonb),
    'commandes', coalesce((
      select jsonb_agg(x.j order by x.cree_le desc) from (
        select o.cree_le, jsonb_build_object(
          'id', o.id, 'numero', o.numero, 'cree_le', o.cree_le, 'mode', o.mode, 'statut', o.statut,
          'total_centimes', o.total_centimes, 'jeton_suivi', o.jeton_suivi,
          'lignes', coalesce((
            select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte) order by l.position)
            from commande_lignes l where l.commande_id = o.id
          ), '[]'::jsonb)
        ) as j
        from commandes o
        where o.compte_id = c.id and o.statut not in ('paiement_en_attente', 'annulee')
        order by o.cree_le desc limit 30
      ) x
    ), '[]'::jsonb),
    'sessions_actives', (select count(*) from sessions_compte s where s.compte_id = c.id and s.revoquee_le is null and s.expire_le > now())
  )
  from comptes c where c.id = p_compte;
$$;

-- Adresses seules, pour l'accueil d'un client connecté.
create function adresses_compte_liste(p_compte uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'adresse', a.adresse, 'details', a.details) order by a.utilisee_le desc), '[]'::jsonb)
  from adresses_compte a where a.compte_id = p_compte;
$$;

create function modifier_profil(p_compte uuid, p jsonb, p_ip_court text) returns void
language plpgsql as $$
begin
  update comptes set prenom = p ->> 'prenom', nom = p ->> 'nom', telephone = p ->> 'telephone' where id = p_compte;
  insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'profil_modifie', p_ip_court);
end;
$$;

create function supprimer_adresse(p_compte uuid, p_adresse uuid, p_ip_court text) returns void
language plpgsql as $$
begin
  delete from adresses_compte where id = p_adresse and compte_id = p_compte;
  if found then
    insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'adresse_supprimee', p_ip_court);
  end if;
end;
$$;

-- Lignes d'une commande du compte, pour « recommander la même chose ». Null si elle n'est pas à lui.
create function lignes_commande_compte(p_compte uuid, p_commande uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', l.plat_slug, 'nom', l.nom, 'qte', l.qte, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note,
    'unitaire_centimes', l.unitaire_centimes
  ) order by l.position), '[]'::jsonb)
  from commandes o join commande_lignes l on l.commande_id = o.id
  where o.id = p_commande and o.compte_id = p_compte
  having count(*) > 0;
$$;

-- Tout ce que le site garde sur le compte (nLPD, droit d'accès). Sans les empreintes de sécurité.
create function export_compte(p_compte uuid, p_ip_court text) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  select jsonb_build_object(
    'export_le', now(),
    'compte', jsonb_build_object('email', c.email, 'prenom', c.prenom, 'nom', c.nom, 'telephone', c.telephone, 'cree_le', c.cree_le, 'modifie_le', c.modifie_le),
    'adresses', coalesce((
      select jsonb_agg(jsonb_build_object('adresse', a.adresse, 'details', a.details, 'utilisee_le', a.utilisee_le) order by a.utilisee_le desc)
      from adresses_compte a where a.compte_id = c.id
    ), '[]'::jsonb),
    'commandes', coalesce((
      select jsonb_agg(
        (to_jsonb(o) - 'cle_idempotence' - 'origine' - 'compte_id' - 'stripe_session_id') || jsonb_build_object(
          'lignes', coalesce((
            select jsonb_agg(to_jsonb(l) - 'id' - 'commande_id' order by l.position)
            from commande_lignes l where l.commande_id = o.id
          ), '[]'::jsonb)
        ) order by o.cree_le desc)
      from commandes o where o.compte_id = c.id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('ouverte_le', s.cree_le, 'expire_le', s.expire_le, 'fermee_le', s.revoquee_le) order by s.cree_le desc)
      from sessions_compte s where s.compte_id = c.id
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('evenement', j.evenement, 'le', j.le) order by j.le desc)
      from journal_connexions j where j.compte_id = c.id
    ), '[]'::jsonb)
  ) into r
  from comptes c where c.id = p_compte;
  if r is not null then
    insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'export', p_ip_court);
  end if;
  return r;
end;
$$;

-- Suppression du compte : profil, adresses, sessions, codes et journal partent. Les commandes déjà passées
-- restent pour la comptabilité du restaurant, détachées du compte.
create function supprimer_compte(p_compte uuid, p_cle_email text) returns boolean
language plpgsql as $$
begin
  update commandes set compte_id = null where compte_id = p_compte;
  delete from codes_connexion where cle_email = p_cle_email;
  delete from comptes where id = p_compte;
  if not found then
    return false;
  end if;
  insert into journal_connexions (compte_id, evenement, ip_court) values (null, 'compte_supprime', null);
  return true;
end;
$$;

-- ---------- Commandes : rattachement au compte ----------

-- Même fonction qu'au lot 5, plus le compte de la session (p ->> 'compte_id') et la case « créer mon compte ».
create or replace function creer_commande(p jsonb) returns table (id uuid, numero integer, jeton_suivi text, deja boolean)
language plpgsql as $$
declare
  existante commandes%rowtype;
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  n integer;
  nouvelle_id uuid;
  cid uuid := (p ->> 'compte_id')::uuid;
begin
  select * into existante from commandes c where c.cle_idempotence = p ->> 'cle_idempotence';
  if found then
    return query select existante.id, existante.numero, existante.jeton_suivi, true;
    return;
  end if;
  insert into compteurs_jour as cj (jour, dernier) values (aujourd_hui, 1)
    on conflict (jour) do update set dernier = cj.dernier + 1
    returning cj.dernier into n;
  insert into commandes (
    numero, jour, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
    client_prenom, client_nom, client_telephone, client_email, adresse, details_livraison, zone_numero,
    quand_type, quand_date, quand_minutes, pizzas_seulement,
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine,
    compte_id, compte_demande
  ) values (
    n, aujourd_hui, p ->> 'jeton_suivi', p ->> 'cle_idempotence', p ->> 'mode', p ->> 'statut', p ->> 'statut_paiement', p ->> 'moyen_paiement',
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

-- Seul le serveur (clé secrète) appelle ces fonctions. Supabase les ouvre par défaut à anon : on ferme.
revoke execute on function
  egal_constant(text, text), attente_limite(text, text, integer, interval, integer, integer),
  enregistrer_adresse(uuid, jsonb, jsonb), completer_depuis_commande(uuid, uuid),
  demander_code(text, text, text, text, text), verifier_code(text, text, text, text, text, text, text, text),
  compte_de_session(text), deconnecter(text, boolean, text), espace_compte(uuid), adresses_compte_liste(uuid), modifier_profil(uuid, jsonb, text),
  supprimer_adresse(uuid, uuid, text), lignes_commande_compte(uuid, uuid), export_compte(uuid, text), supprimer_compte(uuid, text)
  from public, anon, authenticated;
grant execute on function
  egal_constant(text, text), attente_limite(text, text, integer, interval, integer, integer),
  enregistrer_adresse(uuid, jsonb, jsonb), completer_depuis_commande(uuid, uuid),
  demander_code(text, text, text, text, text), verifier_code(text, text, text, text, text, text, text, text),
  compte_de_session(text), deconnecter(text, boolean, text), espace_compte(uuid), adresses_compte_liste(uuid), modifier_profil(uuid, jsonb, text),
  supprimer_adresse(uuid, uuid, text), lignes_commande_compte(uuid, uuid), export_compte(uuid, text), supprimer_compte(uuid, text)
  to service_role;
grant select, insert, update, delete on comptes, codes_connexion, sessions_compte, adresses_compte, tentatives_connexion, journal_connexions to service_role;
grant usage on all sequences in schema public to service_role;
