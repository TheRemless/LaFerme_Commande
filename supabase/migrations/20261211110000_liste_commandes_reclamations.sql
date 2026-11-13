-- Vague 3, bo-commandes : la liste des commandes du back-office filtre les commandes qui ont une réclamation
-- encore ouverte (ou en cours) et donne leur nombre par commande (colonne « Réclamations »).
--
-- Objet partagé recréé : liste_commandes_gestion, reprise de sa seule définition (20261127090000_bo_commandes_liste.sql),
-- avec seulement le filtre avec_reclamation et le champ reclamations en plus. Nommée après la dernière migration de
-- main et après celles des PR #98 et #139 (20261211090000, 20261211100000).
-- Compatible avant et après : même signature, un champ de plus dans chaque ligne, un filtre ignoré tant que
-- l'écran ne l'envoie pas.

create or replace function liste_commandes_gestion(p jsonb) returns jsonb
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
