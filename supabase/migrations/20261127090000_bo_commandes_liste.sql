-- Vague 3, bo-commandes, PR A : liste des commandes du back-office pour 300 commandes par jour, fiche
-- complète et notes internes.
--
-- Objets partagés recréés : aucun. Tout est neuf : commandes_gestion et commande_gestion restent tels
-- quels pour l'écran actuel, qui passera aux nouvelles fonctions avec la coque du back-office.
-- Compatible avant et après : le code de main n'appelle aucune de ces fonctions.

-- ---------- Index ----------

-- Fiche client et recherche par e-mail ou téléphone sur tout l'historique, pas seulement 90 jours.
create index commandes_email_idx on commandes (lower(client_email), cree_le desc);
create index commandes_tel_idx on commandes (tel_national(client_telephone), cree_le desc);

-- ---------- Notes internes ----------

-- Lues par l'équipe seulement, jamais montrées au client. Le nom est copié, comme au journal.
create table notes_commande (
  id bigint generated always as identity primary key,
  commande_id uuid not null references commandes (id) on delete cascade,
  personnel_id uuid references personnel (id) on delete set null,
  personnel_nom text not null,
  texte text not null check (length(texte) between 2 and 500),
  cree_le timestamptz not null default now()
);
create index notes_commande_idx on notes_commande (commande_id, cree_le);
alter table notes_commande enable row level security;
revoke all on notes_commande from anon, authenticated;
grant select, insert, update, delete on notes_commande to service_role;

create function ajouter_note_commande(p_commande uuid, p_texte text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  t text := btrim(coalesce(p_texte, ''));
  r notes_commande%rowtype;
begin
  if length(t) < 2 or length(t) > 500 then
    raise exception 'note_invalide';
  end if;
  if not exists (select 1 from commandes where id = p_commande) then
    raise exception 'commande_inconnue';
  end if;
  insert into notes_commande (commande_id, personnel_id, personnel_nom, texte)
    values (p_commande, p_personnel, nom, t) returning * into r;
  perform journaliser(p_personnel, 'note_commande', p_commande::text, null, jsonb_build_object('note', r.id, 'texte', t));
  return jsonb_build_object('id', r.id, 'texte', r.texte, 'personnel_nom', r.personnel_nom, 'cree_le', r.cree_le);
end;
$$;

-- ---------- Heure prévue et retard ----------

-- Heure confirmée par la tablette, sinon le créneau choisi par le client, sinon rien (« dès que possible »
-- pas encore acceptée).
create function heure_prevue_commande(c commandes) returns timestamptz
language sql stable as $$
  select coalesce(c.heure_confirmee,
    case when c.quand_type = 'creneau' and c.quand_date is not null and c.quand_minutes is not null
      then (c.quand_date + make_interval(mins => c.quand_minutes)) at time zone 'Europe/Zurich' end);
$$;

-- Minutes de retard, ou null :
--   à accepter : attente au-delà du délai d'alerte (réglage alerte_acceptation_minutes), pour une commande du jour ;
--   acceptée ou en préparation : heure promise dépassée (pas encore prête ou partie) ;
--   partie : heure de livraison promise dépassée ;
--   livraison terminée : livrée après l'heure promise.
-- Une commande prête au comptoir n'est pas en retard : c'est le client qui n'est pas encore venu.
create function retard_commande(c commandes, p_alerte integer) returns integer
language sql stable as $$
  select case
    when c.statut = 'nouvelle' then
      case when (c.quand_type = 'asap' or c.quand_date <= (now() at time zone 'Europe/Zurich')::date)
            and coalesce(c.paye_le, c.cree_le) < now() - make_interval(mins => p_alerte)
        then floor(extract(epoch from now() - coalesce(c.paye_le, c.cree_le)) / 60)::integer - p_alerte end
    when c.statut in ('acceptee', 'en_preparation', 'partie') and c.heure_confirmee < now() then
      floor(extract(epoch from now() - c.heure_confirmee) / 60)::integer
    when c.statut = 'terminee' and c.mode = 'livraison' and c.termine_le > c.heure_confirmee then
      floor(extract(epoch from c.termine_le - c.heure_confirmee) / 60)::integer
  end;
$$;

-- ---------- Liste ----------

-- p : { debut?, fin? (jour de service), recherche?, statuts?: [..], mode?, moyen?, paiements?: [..], zone?,
--       livreur?, montant_min?, montant_max? (centimes), remboursee?, en_retard?, avec_note?,
--       tri?: recent | ancien | heure | montant | numero (jour le plus récent, puis numéro croissant), page?, par_page? (10 à 100) }
-- Sans période : le jour même, ou 90 jours en arrière avec une recherche (comme commandes_gestion).
-- Les compteurs par statut suivent tous les filtres sauf celui du statut (pastilles de l'écran). Le serveur valide p avant.
create function liste_commandes_gestion(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  q text := btrim(coalesce(p ->> 'recherche', ''));
  chiffres text := tel_national(q);
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  debut date := coalesce((p ->> 'debut')::date, case when q = '' then aujourd_hui else aujourd_hui - 90 end);
  fin date := coalesce((p ->> 'fin')::date, case when q = '' then aujourd_hui else aujourd_hui + 8 end);
  statuts text[] := case when jsonb_typeof(p -> 'statuts') = 'array' then array(select jsonb_array_elements_text(p -> 'statuts')) end;
  paiements text[] := case when jsonb_typeof(p -> 'paiements') = 'array' then array(select jsonb_array_elements_text(p -> 'paiements')) end;
  par_page integer := least(greatest(coalesce((p ->> 'par_page')::integer, 50), 10), 100);
  page integer := greatest(coalesce((p ->> 'page')::integer, 1), 1);
  tri text := coalesce(p ->> 'tri', 'recent');
  alerte integer := coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'alerte_acceptation_minutes'), 5);
  r jsonb;
begin
  with base as (
    select o.*, heure_prevue_commande(o) as heure_prevue, retard_commande(o, alerte) as retard,
      (select coalesce(sum(rb.montant_centimes), 0) from remboursements rb where rb.commande_id = o.id and rb.statut = 'fait') as rembourse
    from commandes o
    where o.statut not in ('paiement_en_attente', 'annulee')
      and o.jour_service between debut and fin
      and (
        q = ''
        or (q ~ '^\d{1,4}$' and o.numero = q::integer)
        or (length(chiffres) >= 4 and tel_national(o.client_telephone) like '%' || chiffres || '%')
        or (position('@' in q) > 0 and lower(o.client_email) like '%' || lower(q) || '%')
        or (q !~ '^[\d+]' and position('@' in q) = 0 and (o.client_prenom || ' ' || o.client_nom) ilike '%' || q || '%')
      )
      and (p ->> 'mode' is null or o.mode = p ->> 'mode')
      and (p ->> 'moyen' is null or o.moyen_paiement = p ->> 'moyen')
      and (paiements is null or o.statut_paiement = any (paiements))
      and (p ->> 'zone' is null or o.zone_numero = (p ->> 'zone')::smallint)
      and (p ->> 'montant_min' is null or o.total_centimes >= (p ->> 'montant_min')::integer)
      and (p ->> 'montant_max' is null or o.total_centimes <= (p ->> 'montant_max')::integer)
      and (p ->> 'livreur' is null or exists (
        select 1 from livraisons l where l.commande_id = o.id and l.retiree_le is null and l.livreur_id = (p ->> 'livreur')::uuid))
      and (coalesce((p ->> 'remboursee')::boolean, false) = false or exists (
        select 1 from remboursements rb where rb.commande_id = o.id and rb.statut = 'fait'))
      and (coalesce((p ->> 'avec_note')::boolean, false) = false or exists (
        select 1 from notes_commande nc where nc.commande_id = o.id))
  ),
  retenues as (
    select * from base b where coalesce((p ->> 'en_retard')::boolean, false) = false or b.retard > 0
  ),
  filtre as (
    select * from retenues b where statuts is null or b.statut = any (statuts)
  ),
  rangees as (
    select f.*, row_number() over (order by
      case when tri = 'heure' then f.heure_prevue end asc nulls last,
      case when tri = 'montant' then f.total_centimes end desc,
      case when tri = 'numero' then f.jour_service end desc,
      case when tri = 'numero' then f.numero end asc,
      case when tri = 'ancien' then f.cree_le end asc,
      f.cree_le desc, f.id) as rang
    from filtre f
  ),
  page_courante as (
    select * from rangees where rang > (page - 1) * par_page and rang <= page * par_page
  )
  select jsonb_build_object(
    'debut', debut, 'fin', fin, 'page', page, 'par_page', par_page,
    'total', (select count(*) from filtre),
    'compteurs', (select coalesce(jsonb_object_agg(s.statut, s.n), '{}'::jsonb) from (select b.statut, count(*) as n from retenues b group by b.statut) s),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'numero', x.numero, 'jour_service', x.jour_service, 'cree_le', x.cree_le, 'heure_prevue', x.heure_prevue,
        'quand_type', x.quand_type, 'mode', x.mode, 'statut', x.statut, 'statut_paiement', x.statut_paiement,
        'moyen_paiement', x.moyen_paiement, 'client_prenom', x.client_prenom, 'client_nom', x.client_nom,
        'client_telephone', x.client_telephone, 'localite', x.adresse ->> 'localite', 'zone_numero', x.zone_numero,
        'livreur', (select pe.nom from livraisons l join personnel pe on pe.id = l.livreur_id where l.commande_id = x.id and l.retiree_le is null),
        'articles', (select coalesce(sum(cl.qte), 0) from commande_lignes cl where cl.commande_id = x.id),
        'total_centimes', x.total_centimes, 'rembourse_centimes', x.rembourse, 'retard_minutes', x.retard,
        'notes', (select count(*) from notes_commande nc where nc.commande_id = x.id),
        'compte', x.compte_id is not null
      ) order by x.rang) from page_courante x), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

-- ---------- Fiche ----------

-- La fiche de commande_gestion, plus : heure prévue, retard, zone, livreur en cours, e-mails envoyés
-- (sujet, sans le contenu), tickets, notes, historique du client (même e-mail) et une chronologie de
-- tous les événements dans l'ordre. Le contenu d'un e-mail se lit avec courriel_commande_gestion.
create function fiche_commande_gestion(p_id uuid) returns jsonb
language plpgsql stable as $$
declare
  c commandes%rowtype;
  alerte integer := coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'alerte_acceptation_minutes'), 5);
begin
  select * into c from commandes where id = p_id;
  if not found then
    return null;
  end if;
  return commande_gestion(p_id) || jsonb_build_object(
    'heure_prevue', heure_prevue_commande(c),
    'retard_minutes', retard_commande(c, alerte),
    'zone', (select jsonb_build_object('numero', z.numero, 'nom', z.nom) from zones_livraison z where z.numero = c.zone_numero),
    'livreur', (select jsonb_build_object('nom', pe.nom, 'attribuee_le', l.attribuee_le, 'probleme', l.probleme, 'probleme_detail', l.probleme_detail)
      from livraisons l join personnel pe on pe.id = l.livreur_id where l.commande_id = p_id and l.retiree_le is null),
    'courriels', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sujet', m.sujet, 'destinataire', m.destinataire, 'envoye_le', m.envoye_le, 'fournisseur', m.fournisseur) order by m.envoye_le)
      from courriels m where m.commande_id = p_id), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'station', t.station, 'etat', t.etat, 'reimpression', t.reimpression,
        'cree_le', t.cree_le, 'imprime_le', t.imprime_le, 'erreur', t.derniere_erreur) order by t.cree_le)
      from taches_impression t where t.commande_id = p_id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', nc.id, 'texte', nc.texte, 'personnel_nom', nc.personnel_nom, 'cree_le', nc.cree_le) order by nc.cree_le)
      from notes_commande nc where nc.commande_id = p_id), '[]'::jsonb),
    'client', (select jsonb_build_object(
        'commandes', count(*) filter (where o.statut not in ('refusee', 'annulee')),
        'refusees', count(*) filter (where o.statut = 'refusee'),
        'depense_centimes', coalesce(sum(o.total_centimes) filter (where o.statut not in ('refusee', 'annulee')), 0),
        'premiere_le', min(o.cree_le), 'derniere_le', max(o.cree_le))
      from commandes o where lower(o.client_email) = lower(c.client_email) and o.statut not in ('paiement_en_attente', 'annulee')),
    'chronologie', (select coalesce(jsonb_agg(e.j order by e.le, e.ordre), '[]'::jsonb) from (
        select c.cree_le as le, 0 as ordre, jsonb_build_object('type', 'creation', 'le', c.cree_le, 'par', 'client') as j
      union all
        select ep.recu_le, 1, jsonb_build_object('type', 'paiement', 'le', ep.recu_le, 'par', 'stripe', 'detail', ep.type)
        from evenements_paiement ep where ep.commande_id = p_id
      union all
        select ev.le, 2, jsonb_build_object('type', 'statut', 'le', ev.le, 'par', ev.par, 'de', ev.de, 'vers', ev.vers, 'detail', ev.detail)
        from evenements_commande ev where ev.commande_id = p_id
      union all
        select t.cree_le, 3, jsonb_build_object('type', 'ticket', 'le', t.cree_le, 'station', t.station, 'etat', t.etat, 'reimpression', t.reimpression)
        from taches_impression t where t.commande_id = p_id
      union all
        select l.attribuee_le, 4, jsonb_build_object('type', 'livreur', 'le', l.attribuee_le, 'par', l.attribuee_par, 'nom', pe.nom, 'retiree_le', l.retiree_le, 'raison', l.raison_retrait)
        from livraisons l join personnel pe on pe.id = l.livreur_id where l.commande_id = p_id
      union all
        select jl.le, 5, jsonb_build_object('type', 'livraison', 'le', jl.le, 'par', jl.par, 'evenement', jl.evenement, 'detail', jl.detail)
        from journal_livraisons jl where jl.commande_id = p_id
      union all
        select m.envoye_le, 6, jsonb_build_object('type', 'courriel', 'le', m.envoye_le, 'id', m.id, 'sujet', m.sujet)
        from courriels m where m.commande_id = p_id
      union all
        select rb.cree_le, 7, jsonb_build_object('type', 'remboursement', 'le', rb.cree_le, 'par', rb.personnel_nom, 'montant_centimes', rb.montant_centimes, 'statut', rb.statut, 'motif', rb.motif)
        from remboursements rb where rb.commande_id = p_id
      union all
        select nc.cree_le, 8, jsonb_build_object('type', 'note', 'le', nc.cree_le, 'par', nc.personnel_nom, 'texte', nc.texte)
        from notes_commande nc where nc.commande_id = p_id
    ) e)
  );
end;
$$;

-- Texte d'un e-mail envoyé pour cette commande (jamais le HTML). Null si l'e-mail n'est pas le sien :
-- l'identifiant seul ne suffit pas pour lire un autre message.
create function courriel_commande_gestion(p_commande uuid, p_courriel uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', m.id, 'sujet', m.sujet, 'destinataire', m.destinataire, 'texte', m.texte, 'envoye_le', m.envoye_le)
  from courriels m where m.id = p_courriel and m.commande_id = p_commande;
$$;

revoke execute on function
  ajouter_note_commande(uuid, text, uuid), heure_prevue_commande(commandes), retard_commande(commandes, integer),
  liste_commandes_gestion(jsonb), fiche_commande_gestion(uuid), courriel_commande_gestion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  ajouter_note_commande(uuid, text, uuid), heure_prevue_commande(commandes), retard_commande(commandes, integer),
  liste_commandes_gestion(jsonb), fiche_commande_gestion(uuid), courriel_commande_gestion(uuid, uuid)
  to service_role;
