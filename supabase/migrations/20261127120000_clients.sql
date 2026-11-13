-- Vague 3, bo-commandes : clients dans le back-office (liste, fiche, notes, marque).
-- Il n'y a pas de table des clients : un client est une adresse e-mail (en minuscules), avec ou sans compte.
-- Les invités se retrouvent donc comme les autres, par e-mail, téléphone ou nom. Les chiffres viennent des
-- commandes, jamais recopiés : rien à tenir à jour.
--
-- Marque « à surveiller » ou « bloqué » : règle envers le client, décision de Jérémy (D2), désactivée par
-- défaut (réglage marque_client_active). Tant qu'il est faux, aucune marque ne se pose. Même activée, une
-- marque ne bloque rien ici : la fonction client_marque(email, telephone) est prête pour le parcours de
-- commande (session client-commande), qui décidera de son effet avec Jérémy.
--
-- Objets partagés recréés : aucun (tables et fonctions neuves). Compatible avant et après : le code de main
-- n'appelle aucune de ces fonctions.

insert into reglages (cle, valeur, proposition) values ('marque_client_active', 'false', true)
on conflict (cle) do nothing;

-- ---------- Tables ----------

create table notes_client (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(btrim(email)) and length(email) between 5 and 120),
  personnel_id uuid references personnel (id) on delete set null,
  personnel_nom text not null,
  texte text not null check (length(texte) between 2 and 500),
  cree_le timestamptz not null default now()
);
create index notes_client_idx on notes_client (email, cree_le);

create table marques_client (
  email text primary key check (email = lower(btrim(email)) and length(email) between 5 and 120),
  marque text not null check (marque in ('surveiller', 'bloque')),
  motif text not null check (length(motif) between 3 and 200),
  personnel_id uuid references personnel (id) on delete set null,
  personnel_nom text not null,
  le timestamptz not null default now()
);

alter table notes_client enable row level security;
alter table marques_client enable row level security;
revoke all on notes_client, marques_client from anon, authenticated;
grant select, insert, update, delete on notes_client, marques_client to service_role;

-- ---------- Liste ----------

-- p : { recherche?, tri?: derniere | depense | commandes | nom, avec_compte?, marque?: surveiller | bloque,
--       inactif_jours? (dernière commande il y a plus de N jours), page?, par_page? (10 à 100) }
-- Une ligne par e-mail. Prénom, nom et téléphone : ceux de la dernière commande. Dépensé : commandes servies,
-- remboursements déduits. Le serveur valide p avant.
create function clients_gestion(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  q text := btrim(coalesce(p ->> 'recherche', ''));
  chiffres text := tel_national(q);
  par_page integer := least(greatest(coalesce((p ->> 'par_page')::integer, 50), 10), 100);
  page integer := greatest(coalesce((p ->> 'page')::integer, 1), 1);
  tri text := coalesce(p ->> 'tri', 'derniere');
  r jsonb;
begin
  with cibles as (
    -- Recherche : les e-mails dont une commande correspond, sur tout l'historique.
    select distinct lower(o.client_email) as email from commandes o
    where q <> '' and o.statut not in ('paiement_en_attente', 'annulee') and (
      (length(chiffres) >= 4 and tel_national(o.client_telephone) like '%' || chiffres || '%')
      or (position('@' in q) > 0 and lower(o.client_email) like '%' || lower(q) || '%')
      or (q !~ '^[\d+]' and position('@' in q) = 0 and (o.client_prenom || ' ' || o.client_nom) ilike '%' || q || '%')
    )
  ),
  agg as (
    select lower(o.client_email) as email,
      count(*) filter (where o.statut <> 'refusee') as commandes,
      count(*) filter (where o.statut = 'refusee') as refusees,
      coalesce(sum(o.total_centimes) filter (where o.statut <> 'refusee'), 0) as servi,
      min(o.cree_le) as premiere, max(o.cree_le) as derniere,
      (array_agg(o.client_prenom order by o.cree_le desc))[1] as prenom,
      (array_agg(o.client_nom order by o.cree_le desc))[1] as nom,
      (array_agg(o.client_telephone order by o.cree_le desc))[1] as telephone
    from commandes o
    where o.statut not in ('paiement_en_attente', 'annulee')
      and (q = '' or lower(o.client_email) in (select email from cibles))
    group by lower(o.client_email)
  ),
  filtre as (
    select a.*, m.marque, exists (select 1 from comptes k where k.email = a.email) as compte
    from agg a left join marques_client m on m.email = a.email
    where (p ->> 'marque' is null or m.marque = p ->> 'marque')
      and (coalesce((p ->> 'avec_compte')::boolean, false) = false or exists (select 1 from comptes k where k.email = a.email))
      and (p ->> 'inactif_jours' is null or a.derniere < now() - make_interval(days => (p ->> 'inactif_jours')::integer))
  ),
  rangees as (
    select f.*, row_number() over (order by
      case when tri = 'depense' then f.servi end desc,
      case when tri = 'commandes' then f.commandes end desc,
      case when tri = 'nom' then lower(f.nom || ' ' || f.prenom) end asc,
      f.derniere desc, f.email) as rang
    from filtre f
  ),
  page_courante as (
    select * from rangees where rang > (page - 1) * par_page and rang <= page * par_page
  )
  select jsonb_build_object(
    'page', page, 'par_page', par_page, 'total', (select count(*) from filtre),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object(
        'email', x.email, 'prenom', x.prenom, 'nom', x.nom, 'telephone', x.telephone,
        'commandes', x.commandes, 'refusees', x.refusees,
        'depense_centimes', x.servi - (select coalesce(sum(rb.montant_centimes), 0) from remboursements rb join commandes o on o.id = rb.commande_id
          where lower(o.client_email) = x.email and rb.statut = 'fait' and o.statut <> 'refusee'),
        'panier_moyen_centimes', case when x.commandes > 0 then round(x.servi::numeric / x.commandes)::integer end,
        'premiere_le', x.premiere, 'derniere_le', x.derniere, 'compte', x.compte, 'marque', x.marque,
        'notes', (select count(*) from notes_client nc where nc.email = x.email)
      ) order by x.rang) from page_courante x), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ---------- Fiche ----------

-- Tout ce que le restaurant sait d'un client : chiffres, commandes (les 100 dernières), adresses de
-- livraison et téléphones utilisés, plats préférés, remboursements, notes, marque, compte. Null si aucun
-- e-mail ne correspond. Les commandes de plus de 100 se lisent avec liste_commandes_gestion (recherche).
create function fiche_client_gestion(p_email text) returns jsonb
language plpgsql stable as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  r jsonb;
begin
  if not exists (select 1 from commandes where lower(client_email) = e and statut not in ('paiement_en_attente', 'annulee')) then
    return null;
  end if;
  with cmd as (
    select * from commandes o where lower(o.client_email) = e and o.statut not in ('paiement_en_attente', 'annulee')
  ),
  servies as (select * from cmd where statut <> 'refusee')
  select jsonb_build_object(
    'email', e,
    'prenom', (select client_prenom from cmd order by cree_le desc limit 1),
    'nom', (select client_nom from cmd order by cree_le desc limit 1),
    'commandes', (select count(*) from servies),
    'refusees', (select count(*) from cmd where statut = 'refusee'),
    'servi_centimes', (select coalesce(sum(total_centimes), 0) from servies),
    'rembourse_centimes', (select coalesce(sum(rb.montant_centimes), 0) from remboursements rb join servies s on s.id = rb.commande_id where rb.statut = 'fait'),
    'panier_moyen_centimes', (select round(avg(total_centimes))::integer from servies),
    'premiere_le', (select min(cree_le) from cmd), 'derniere_le', (select max(cree_le) from cmd),
    -- Jours en moyenne entre deux commandes servies (null avant la deuxième).
    'frequence_jours', (select case when count(*) > 1 then round(extract(epoch from max(cree_le) - min(cree_le)) / 86400 / (count(*) - 1), 1) end from servies),
    'livraisons', (select count(*) from servies where mode = 'livraison'),
    'retraits', (select count(*) from servies where mode = 'retrait'),
    'telephones', (select coalesce(jsonb_agg(t.tel order by t.derniere desc), '[]'::jsonb) from (
        select client_telephone as tel, max(cree_le) as derniere from cmd group by client_telephone) t),
    'adresses', (select coalesce(jsonb_agg(jsonb_build_object('adresse', a.adresse, 'fois', a.fois, 'derniere_le', a.derniere) order by a.derniere desc), '[]'::jsonb) from (
        select adresse - 'featureId' as adresse, count(*) as fois, max(cree_le) as derniere from cmd where adresse is not null group by adresse - 'featureId') a),
    'plats', (select coalesce(jsonb_agg(jsonb_build_object('nom', pl.nom, 'qte', pl.qte) order by pl.qte desc, pl.nom), '[]'::jsonb) from (
        select l.nom, sum(l.qte)::integer as qte from commande_lignes l join servies s on s.id = l.commande_id group by l.nom order by 2 desc, 1 limit 5) pl),
    'commandes_liste', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero', c.numero, 'jour_service', c.jour_service, 'cree_le', c.cree_le, 'mode', c.mode, 'statut', c.statut,
        'statut_paiement', c.statut_paiement, 'total_centimes', c.total_centimes,
        'rembourse_centimes', (select coalesce(sum(rb.montant_centimes), 0) from remboursements rb where rb.commande_id = c.id and rb.statut = 'fait')
      ) order by c.cree_le desc), '[]'::jsonb) from (select * from cmd order by cree_le desc limit 100) c),
    'remboursements', (select coalesce(jsonb_agg(jsonb_build_object(
        'commande_id', rb.commande_id, 'numero', c.numero, 'montant_centimes', rb.montant_centimes, 'motif', rb.motif, 'statut', rb.statut,
        'personnel_nom', rb.personnel_nom, 'cree_le', rb.cree_le) order by rb.cree_le desc), '[]'::jsonb)
      from remboursements rb join cmd c on c.id = rb.commande_id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', nc.id, 'texte', nc.texte, 'personnel_nom', nc.personnel_nom, 'cree_le', nc.cree_le) order by nc.cree_le desc), '[]'::jsonb)
      from notes_client nc where nc.email = e),
    'marque', (select jsonb_build_object('marque', m.marque, 'motif', m.motif, 'personnel_nom', m.personnel_nom, 'le', m.le) from marques_client m where m.email = e),
    'marque_active', coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'marque_client_active' and jsonb_typeof(valeur) = 'boolean'), false),
    'compte', (select jsonb_build_object('cree_le', k.cree_le, 'adresses', (select count(*) from adresses_compte ad where ad.compte_id = k.id)) from comptes k where k.email = e)
  ) into r;
  return r;
end;
$$;

-- ---------- Écritures (gérant) ----------

create function ajouter_note_client(p_email text, p_texte text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  e text := lower(btrim(coalesce(p_email, '')));
  t text := btrim(coalesce(p_texte, ''));
  r notes_client%rowtype;
begin
  if length(t) < 2 or length(t) > 500 then
    raise exception 'note_invalide';
  end if;
  if not exists (select 1 from commandes where lower(client_email) = e) then
    raise exception 'client_inconnu';
  end if;
  insert into notes_client (email, personnel_id, personnel_nom, texte) values (e, p_personnel, nom, t) returning * into r;
  perform journaliser(p_personnel, 'note_client', e, null, jsonb_build_object('note', r.id, 'texte', t));
  return jsonb_build_object('id', r.id, 'texte', r.texte, 'personnel_nom', r.personnel_nom, 'cree_le', r.cree_le);
end;
$$;

-- p_marque null : retire la marque. Refusé tant que le réglage marque_client_active est faux.
create function marquer_client(p_email text, p_marque text, p_motif text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  e text := lower(btrim(coalesce(p_email, '')));
  m text := btrim(coalesce(p_motif, ''));
  avant marques_client%rowtype;
begin
  if not coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'marque_client_active' and jsonb_typeof(valeur) = 'boolean'), false) then
    raise exception 'marque_desactivee';
  end if;
  if p_marque is not null and p_marque not in ('surveiller', 'bloque') then
    raise exception 'marque_invalide';
  end if;
  if p_marque is not null and (length(m) < 3 or length(m) > 200) then
    raise exception 'motif_invalide';
  end if;
  if not exists (select 1 from commandes where lower(client_email) = e) then
    raise exception 'client_inconnu';
  end if;
  select * into avant from marques_client where email = e for update;
  if p_marque is null then
    delete from marques_client where email = e;
  else
    insert into marques_client (email, marque, motif, personnel_id, personnel_nom) values (e, p_marque, m, p_personnel, nom)
    on conflict (email) do update set marque = excluded.marque, motif = excluded.motif, personnel_id = excluded.personnel_id,
      personnel_nom = excluded.personnel_nom, le = now();
  end if;
  perform journaliser(p_personnel, 'client', e,
    case when avant.email is not null then jsonb_build_object('marque', avant.marque, 'motif', avant.motif) end,
    case when p_marque is not null then jsonb_build_object('marque', p_marque, 'motif', m) end);
  return (select jsonb_build_object('marque', mc.marque, 'motif', mc.motif, 'personnel_nom', mc.personnel_nom, 'le', mc.le) from marques_client mc where mc.email = e);
end;
$$;

-- Pour le parcours de commande, quand Jérémy aura décidé de l'effet : marque du client par e-mail, ou par
-- téléphone (même numéro sous une autre adresse). Null sans marque, ou tant que le réglage est faux.
create function client_marque(p_email text, p_telephone text) returns text
language sql stable as $$
  select m.marque from marques_client m
  where coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'marque_client_active' and jsonb_typeof(valeur) = 'boolean'), false)
    and (m.email = lower(btrim(coalesce(p_email, '')))
      or (length(tel_national(p_telephone)) >= 9 and m.email in (
        select lower(o.client_email) from commandes o where tel_national(o.client_telephone) = tel_national(p_telephone))))
  order by m.marque = 'bloque' desc
  limit 1;
$$;

-- nLPD : ce que le back-office garde sur un client, pour l'export et la suppression demandés par le client
-- (session client-compte, src/app/api/compte/). Les notes internes sont des données personnelles : elles
-- partent avec l'export et sont effacées avec le compte. La marque reste (proposition, décision de Jérémy) :
-- supprimer son compte ne doit pas lever un blocage ; elle reste visible dans l'export.
create function donnees_gestion_client(p_email text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('texte', nc.texte, 'cree_le', nc.cree_le) order by nc.cree_le)
      from notes_client nc where nc.email = lower(btrim(coalesce(p_email, '')))), '[]'::jsonb),
    'marque', (select jsonb_build_object('marque', m.marque, 'motif', m.motif, 'le', m.le) from marques_client m where m.email = lower(btrim(coalesce(p_email, '')))));
$$;

create function effacer_notes_client(p_email text) returns integer
language plpgsql as $$
declare
  n integer;
begin
  delete from notes_client where email = lower(btrim(coalesce(p_email, '')));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function
  clients_gestion(jsonb), fiche_client_gestion(text), ajouter_note_client(text, text, uuid),
  marquer_client(text, text, text, uuid), client_marque(text, text), donnees_gestion_client(text), effacer_notes_client(text)
  from public, anon, authenticated;
grant execute on function
  clients_gestion(jsonb), fiche_client_gestion(text), ajouter_note_client(text, text, uuid),
  marquer_client(text, text, text, uuid), client_marque(text, text), donnees_gestion_client(text), effacer_notes_client(text)
  to service_role;
