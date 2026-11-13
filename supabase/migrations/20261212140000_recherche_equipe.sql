-- Vague 3, bo-socle (relance du chef de produit gestion, 13.11) : la recherche des commandes et des clients
-- (liste de Commandes, rubrique Clients, recherche ⌘K) trouve « bonardi yanis » (nom avant prénom : chaque mot
-- doit figurer dans « prénom nom », dans n'importe quel ordre) et le début d'un e-mail tapé sans @ (« yanis.bon »).
--
-- Équipe : liste_personnel donne aussi la dernière activité de chacun (connexion ou passage sur un appareil),
-- sans quoi une tablette connectée depuis un mois affichait la date de sa connexion.
--
-- Objets partagés recréés, chacun depuis sa seule définition en vigueur dans main :
--   liste_commandes_gestion (20261212130000_liste_commandes_remboursement.sql de bo-commandes, PR #197, fusionnée avant),
--   clients_gestion (20261127120000_clients.sql),
--   liste_personnel (20261210250000_appareils_equipe.sql).
-- liste_commandes_gestion : seules changent les conditions de recherche (deux variables mots et debut_email) ;
-- le reste, filtre remboursement compris, est la définition de 20261212130000 telle quelle. Même signature, mêmes champs.
-- clients_gestion : seules changent les conditions de recherche.
-- liste_personnel : un champ de plus (derniere_activite), l'écran lit encore derniere_connexion sans lui.
-- Numéro réservé par le chef (20261212140000), juste après 20261212130000.

create or replace function liste_commandes_gestion(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  q text := btrim(coalesce(p ->> 'recherche', ''));
  chiffres text := tel_national(q);
  -- Chaque mot doit figurer dans « prénom nom », dans n'importe quel ordre (« bonardi yanis »).
  mots text[] := array_remove(regexp_split_to_array(lower(q), '\s+'), '');
  -- Début d'e-mail sans @ (« yanis.bon ») : un seul mot de trois caractères au moins avec une lettre (pas un numéro), % et _ pris à la lettre.
  debut_email text := case when q ~ '^[^\s@]{3,}$' and q ~ '[[:alpha:]]' then replace(replace(replace(lower(q), '\', '\\'), '%', '\%'), '_', '\_') else '' end;
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
        or (q !~ '^[\d+]' and position('@' in q) = 0 and not exists (
          select 1 from unnest(mots) w where strpos(lower(o.client_prenom || ' ' || o.client_nom), w) = 0))
        or (debut_email <> '' and lower(o.client_email) like debut_email || '%')
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
      and (p ->> 'remboursement' is null or exists (
        select 1 from remboursements rb where rb.commande_id = o.id and rb.statut = p ->> 'remboursement'))
      and (coalesce((p ->> 'avec_note')::boolean, false) = false or exists (
        select 1 from notes_commande nc where nc.commande_id = o.id))
      and (p ->> 'service' is null or (case when extract(hour from coalesce(heure_prevue_commande(o), o.cree_le) at time zone 'Europe/Zurich') < 15
            then 'midi' else 'soir' end) = p ->> 'service')
      and (coalesce((p ->> 'avec_reclamation')::boolean, false) = false or exists (
        select 1 from reclamations rc where rc.commande_id = o.id and rc.statut <> 'close'))
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
        'reclamations', (select count(*) from reclamations rc where rc.commande_id = x.id and rc.statut <> 'close'),
        'compte', x.compte_id is not null
      ) order by x.rang) from page_courante x), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

create or replace function clients_gestion(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  q text := btrim(coalesce(p ->> 'recherche', ''));
  chiffres text := tel_national(q);
  -- Chaque mot doit figurer dans « prénom nom », dans n'importe quel ordre (« bonardi yanis »).
  mots text[] := array_remove(regexp_split_to_array(lower(q), '\s+'), '');
  -- Début d'e-mail sans @ (« yanis.bon ») : un seul mot de trois caractères au moins avec une lettre (pas un numéro), % et _ pris à la lettre.
  debut_email text := case when q ~ '^[^\s@]{3,}$' and q ~ '[[:alpha:]]' then replace(replace(replace(lower(q), '\', '\\'), '%', '\%'), '_', '\_') else '' end;
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
      or (q !~ '^[\d+]' and position('@' in q) = 0 and not exists (
          select 1 from unnest(mots) w where strpos(lower(o.client_prenom || ' ' || o.client_nom), w) = 0))
        or (debut_email <> '' and lower(o.client_email) like debut_email || '%')
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

-- Équipe : dernière activité (greatest ignore un vue_le nul).
create or replace function liste_personnel(p_personnel uuid) returns jsonb
language plpgsql stable as $$
begin
  perform gerant_nom(p_personnel);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'email', p.email, 'nom', p.nom, 'role', p.role, 'actif', p.actif,
      'sessions', (select count(*) from sessions_personnel s where s.personnel_id = p.id and s.revoquee_le is null and s.expire_le > now()
                     and (p.role <> 'livreur' or s.cree_le > now() - interval '12 hours')),
      'derniere_connexion', (select max(s.cree_le) from sessions_personnel s where s.personnel_id = p.id),
      'derniere_activite', (select max(greatest(s.cree_le, s.vue_le)) from sessions_personnel s where s.personnel_id = p.id)
    ) order by p.actif desc, p.role desc, p.nom)
    from personnel p
  ), '[]'::jsonb);
end;
$$;
