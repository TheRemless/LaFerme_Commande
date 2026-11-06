-- Lot 5 : commandes, paiements et courriels.
-- Aucune lecture ni écriture publique : tout passe par le serveur avec la clé secrète
-- (rôle service_role), à travers les fonctions ci-dessous. Les visiteurs n'ont aucun droit.

create table compteurs_jour (
  jour date primary key,
  dernier integer not null
);

create table commandes (
  id uuid primary key default gen_random_uuid(),
  -- Numéro court du jour, celui que l'on dit au téléphone et qui sort sur le ticket.
  numero integer not null,
  jour date not null,
  -- Jeton du lien de suivi : seul secret qui donne accès à la commande sans compte.
  jeton_suivi text not null unique,
  -- Clé envoyée par le navigateur pour qu'un double clic ne crée pas deux commandes.
  cle_idempotence text not null unique,
  mode text not null check (mode in ('livraison', 'retrait')),
  statut text not null check (statut in ('paiement_en_attente', 'nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie', 'terminee', 'refusee', 'annulee')),
  statut_paiement text not null check (statut_paiement in ('en_attente', 'paye', 'a_encaisser_retrait', 'encaisse', 'rembourse', 'echec')),
  moyen_paiement text not null check (moyen_paiement in ('en_ligne', 'comptoir')),
  client_prenom text not null,
  client_nom text not null,
  client_telephone text not null,
  client_email text not null,
  adresse jsonb,
  details_livraison jsonb,
  zone_numero smallint,
  quand_type text not null check (quand_type in ('asap', 'creneau')),
  quand_date date,
  quand_minutes smallint,
  heure_confirmee timestamptz,
  pizzas_seulement boolean not null,
  sous_total_centimes integer not null,
  frais_centimes integer not null,
  total_centimes integer not null,
  tva_centimes integer not null,
  taux_tva_pourcent numeric(4, 2) not null,
  stripe_session_id text unique,
  stripe_payment_intent text,
  motif text,
  -- Adresse du site où la commande a été passée, contrôlée par le serveur : sert aux liens des courriels.
  origine text not null,
  cree_le timestamptz not null default now(),
  paye_le timestamptz,
  rembourse_le timestamptz,
  modifie_le timestamptz not null default now(),
  unique (jour, numero)
);
create index commandes_statut_idx on commandes (statut, cree_le);

create table commande_lignes (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references commandes (id) on delete cascade,
  position smallint not null,
  plat_slug text not null,
  nom text not null,
  station station not null,
  qte smallint not null check (qte between 1 and 20),
  unitaire_centimes integer not null,
  total_centimes integer not null,
  choix jsonb not null default '{}',
  retraits jsonb not null default '[]',
  note text not null default ''
);
create index commande_lignes_commande_idx on commande_lignes (commande_id, position);

-- Chaque événement de paiement n'est appliqué qu'une fois (webhook rejoué, retour du client, réconciliation).
create table evenements_paiement (
  id text primary key,
  commande_id uuid references commandes (id) on delete set null,
  type text not null,
  recu_le timestamptz not null default now()
);

-- Courriels envoyés ou, sans Resend, gardés par la doublure pour les montrer en préversion.
create table courriels (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid references commandes (id) on delete set null,
  destinataire text not null,
  sujet text not null,
  texte text not null,
  html text not null,
  fournisseur text not null,
  envoye_le timestamptz not null default now()
);

create trigger commandes_modifie_le before update on commandes
  for each row execute function maj_modifie_le();

alter table compteurs_jour enable row level security;
alter table commandes enable row level security;
alter table commande_lignes enable row level security;
alter table evenements_paiement enable row level security;
alter table courriels enable row level security;
-- Aucune politique : sans clé secrète, rien n'est lisible ni modifiable.
revoke all on compteurs_jour, commandes, commande_lignes, evenements_paiement, courriels from anon, authenticated;

-- ---------- Fonctions appelées par le serveur ----------

-- Crée la commande et ses lignes d'un bloc. Rejouée avec la même clé, renvoie la commande existante.
create function creer_commande(p jsonb) returns table (id uuid, numero integer, jeton_suivi text, deja boolean)
language plpgsql as $$
declare
  existante commandes%rowtype;
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  n integer;
  nouvelle_id uuid;
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
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine
  ) values (
    n, aujourd_hui, p ->> 'jeton_suivi', p ->> 'cle_idempotence', p ->> 'mode', p ->> 'statut', p ->> 'statut_paiement', p ->> 'moyen_paiement',
    p ->> 'client_prenom', p ->> 'client_nom', p ->> 'client_telephone', p ->> 'client_email', p -> 'adresse', p -> 'details_livraison',
    (p ->> 'zone_numero')::smallint,
    p ->> 'quand_type', (p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, (p ->> 'pizzas_seulement')::boolean,
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, (p ->> 'taux_tva_pourcent')::numeric, p ->> 'origine'
  ) returning commandes.id into nouvelle_id;
  insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, retraits, note)
  select nouvelle_id, (l.ordinality - 1)::smallint, l.v ->> 'slug', l.v ->> 'nom', (l.v ->> 'station')::station, (l.v ->> 'qte')::smallint,
         (l.v ->> 'unitaire_centimes')::integer, (l.v ->> 'total_centimes')::integer, l.v -> 'choix', l.v -> 'retraits', coalesce(l.v ->> 'note', '')
  from jsonb_array_elements(p -> 'lignes') with ordinality as l(v, ordinality);
  return query select nouvelle_id, n, p ->> 'jeton_suivi', false;
end;
$$;

create function lier_session_paiement(p_commande uuid, p_session text) returns void
language sql as $$
  update commandes set stripe_session_id = p_session where id = p_commande and stripe_session_id is null;
$$;

-- Applique un événement de paiement une seule fois. Les transitions ne vont que dans un sens :
-- un paiement confirmé ne repasse jamais en attente, un remboursement est définitif.
create function appliquer_paiement(p_evenement text, p_commande uuid, p_type text, p_payment_intent text default null)
returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  insert into evenements_paiement (id, commande_id, type) values (p_evenement, p_commande, p_type)
    on conflict (id) do nothing;
  if not found then
    return false;
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    return false;
  end if;
  if p_type = 'paye' and c.statut_paiement = 'en_attente' then
    update commandes set statut_paiement = 'paye', statut = 'nouvelle', paye_le = now(),
      stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent)
    where id = p_commande;
  elsif p_type = 'echec' and c.statut_paiement = 'en_attente' then
    update commandes set statut_paiement = 'echec', statut = 'annulee', motif = 'Paiement non abouti' where id = p_commande;
  elsif p_type = 'rembourse' and c.statut_paiement in ('paye', 'encaisse') then
    update commandes set statut_paiement = 'rembourse', rembourse_le = now() where id = p_commande;
  else
    return false;
  end if;
  return true;
end;
$$;

create function commande_par_jeton(p_jeton text) returns jsonb
language sql stable as $$
  select to_jsonb(c) || jsonb_build_object(
    'lignes', coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from commande_lignes l where l.commande_id = c.id), '[]'::jsonb)
  )
  from commandes c where c.jeton_suivi = p_jeton;
$$;

create function commande_par_id(p_id uuid) returns jsonb
language sql stable as $$
  select to_jsonb(c) || jsonb_build_object(
    'lignes', coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from commande_lignes l where l.commande_id = c.id), '[]'::jsonb)
  )
  from commandes c where c.id = p_id;
$$;

create function enregistrer_courriel(p jsonb) returns void
language sql as $$
  insert into courriels (commande_id, destinataire, sujet, texte, html, fournisseur)
  values ((p ->> 'commande_id')::uuid, p ->> 'destinataire', p ->> 'sujet', p ->> 'texte', p ->> 'html', p ->> 'fournisseur');
$$;

-- Seul le serveur (clé secrète) appelle ces fonctions. Supabase les ouvre par défaut à anon : on ferme.
revoke execute on function creer_commande(jsonb), lier_session_paiement(uuid, text), appliquer_paiement(text, uuid, text, text),
  commande_par_jeton(text), commande_par_id(uuid), enregistrer_courriel(jsonb)
  from public, anon, authenticated;
grant execute on function creer_commande(jsonb), lier_session_paiement(uuid, text), appliquer_paiement(text, uuid, text, text),
  commande_par_jeton(text), commande_par_id(uuid), enregistrer_courriel(jsonb)
  to service_role;
grant select, insert, update, delete on compteurs_jour, commandes, commande_lignes, evenements_paiement, courriels to service_role;
