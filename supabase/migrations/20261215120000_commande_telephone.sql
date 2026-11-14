-- Vague 3, bo-commandes : commande prise au téléphone par l'équipe, depuis la tablette (Jérémy, 14.11.2026 :
-- « on centralise tout »). La commande entre acceptée, avec ses tickets, payée à la livraison ou au retrait
-- (moyen « comptoir », statut « a_encaisser_retrait », encaissée ensuite en espèces ou par carte comme un retrait).
-- Elle compte dans la capacité (creer_commande), les rapports, la clôture et l'export Crésus comme une commande
-- au comptoir. Marque « Téléphone » sur la tablette, le ticket et la page du livreur.
--
-- Table partagée, ajout seul : commandes.canal (site | telephone), en fin de table, « site » par défaut.
-- Objets recréés, chacun depuis sa dernière définition dans main :
--   verifier_plafond_comptoir (20261115090000_plafond_comptoir.sql) : une commande prise au téléphone n'est pas
--     soumise au plafond du comptoir (décision à confirmer par Jérémy, signalée au chef) ;
--   file_tablette et livraisons_livreur (20261212110000_tablette_nouveautes_client.sql, tablette) : seul ajout,
--     le champ « canal » ;
--   clients_gestion (20261212140000_recherche_equipe.sql) : une commande sans e-mail ne fait pas une fiche client.
-- Fonction neuve : creer_commande_telephone. Numéro réservé par le chef (plage de bo-commandes).
-- Compatible avant et après : l'ancien code ignore le canal.

alter table commandes add column canal text not null default 'site' check (canal in ('site', 'telephone'));

create or replace function verifier_plafond_comptoir() returns trigger
language plpgsql as $$
declare
  plafond numeric;
begin
  -- Lu seulement pour le comptoir : un réglage mal saisi ne bloque jamais le paiement en ligne.
  if new.moyen_paiement <> 'comptoir' then
    return new;
  end if;
  -- Commande prise au téléphone par l'équipe (creer_commande_telephone pose laferme.canal dans sa transaction) :
  -- le plafond protège le site contre les commandes non payées, pas l'équipe qui parle au client.
  if coalesce(current_setting('laferme.canal', true), '') = 'telephone' then
    return new;
  end if;
  select (valeur #>> '{}')::numeric into plafond from reglages
  where cle = 'plafond_comptoir_centimes' and jsonb_typeof(valeur) = 'number';
  -- Réglage absent ou illisible : pas de comptoir.
  if plafond is null or new.total_centimes > plafond then
    raise exception 'plafond_comptoir';
  end if;
  return new;
end;
$$;

create or replace function file_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.cree_le), '[]'::jsonb) from (
    select o.cree_le, jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'cree_le', o.cree_le, 'attend_depuis', coalesce(o.paye_le, o.cree_le),
      'mode', o.mode, 'statut', o.statut,
      'statut_paiement', o.statut_paiement, 'moyen_paiement', o.moyen_paiement, 'canal', o.canal,
      'client_prenom', o.client_prenom, 'client_nom', o.client_nom, 'client_telephone', o.client_telephone,
      'adresse', o.adresse, 'details_livraison', o.details_livraison, 'zone_numero', o.zone_numero,
      'quand_type', o.quand_type, 'quand_date', o.quand_date, 'quand_minutes', o.quand_minutes,
      'heure_confirmee', o.heure_confirmee, 'pizzas_seulement', o.pizzas_seulement,
      'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
      'motif', o.motif, 'avertissement', o.avertissement,
      -- Vague 3 (tablette) : moyen noté à l'encaissement au comptoir, annulation faite par le client (#70).
      'moyen_comptoir', o.moyen_comptoir, 'annulee_par_client_le', o.annulee_par_client_le,
      -- Vague 3 (client-commande, 20261210130000 à 20261210210000) : allergie de toute la commande, personne qui
      -- reçoit la commande ({ nom, telephone } ou null), couverts et serviettes, prénom de chaque ligne.
      'allergie', o.allergie, 'destinataire', o.destinataire, 'couverts', o.couverts,
      'lignes', coalesce((
        select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte, 'station', l.station, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note, 'pour', l.pour) order by l.position)
        from commande_lignes l where l.commande_id = o.id
      ), '[]'::jsonb)
    ) as j
    from commandes o
    where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
       or (o.statut in ('terminee', 'refusee') and o.modifie_le >= ((now() at time zone 'Europe/Zurich')::date::timestamp at time zone 'Europe/Zurich'))
       or (o.statut = 'refusee' and o.statut_paiement = 'paye')
  ) x;
$$;

create or replace function livraisons_livreur(p_livreur uuid) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  insert into activite_livreurs (personnel_id, vu_le) values (p_livreur, now())
    on conflict (personnel_id) do update set vu_le = excluded.vu_le;
  insert into journal_livraisons (commande_id, personnel_id, par, evenement)
    select l.commande_id, p_livreur, 'livreur:' || p.nom, 'vue'
    from livraisons l join commandes o on o.id = l.commande_id join personnel p on p.id = p_livreur
    where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    on conflict do nothing;
  select jsonb_build_object(
    'livraisons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', o.id, 'numero', o.numero, 'statut', o.statut, 'heure', o.heure_confirmee,
        'adresse', jsonb_build_object('rue', o.adresse ->> 'rue', 'numero', o.adresse ->> 'numero', 'npa', o.adresse ->> 'npa', 'localite', o.adresse ->> 'localite'),
        'details', o.details_livraison, 'zone', o.zone_numero,
        'prenom', o.client_prenom, 'telephone', o.client_telephone,
        -- Vague 3 : la personne qui reçoit la commande, quand ce n'est pas celle qui a commandé (client-commande).
        'destinataire', o.destinataire,
        'articles', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id),
        'pizzas', (select coalesce(sum(x.qte), 0) from commande_lignes x where x.commande_id = o.id and x.station = 'pizza'),
        'paye', o.statut_paiement = 'paye', 'total_centimes', o.total_centimes, 'canal', o.canal,
        'probleme', l.probleme, 'probleme_detail', l.probleme_detail
      ) order by l.position, l.attribuee_le)
      from livraisons l join commandes o on o.id = l.commande_id
      where l.livreur_id = p_livreur and l.retiree_le is null and o.statut in ('acceptee', 'en_preparation', 'partie')
    ), '[]'::jsonb),
    'retirees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commande_id', o.id, 'numero', o.numero,
        'raison', case when l.retiree_le is null or l.raison_retrait = 'annulee' then 'annulee' else l.raison_retrait end,
        'partie', exists (select 1 from evenements_commande v where v.commande_id = o.id and v.vers = 'partie')
      ) order by o.numero)
      from livraisons l join commandes o on o.id = l.commande_id
      where l.livreur_id = p_livreur and l.retrait_vu_le is null and l.attribuee_le > now() - interval '12 hours'
        and ((l.retiree_le is not null and l.raison_retrait in ('reattribuee', 'retiree', 'client_absent')
              -- Rendue au même livreur entre-temps : elle est dans sa liste, pas d'alerte.
              and not exists (select 1 from livraisons y where y.commande_id = l.commande_id and y.livreur_id = p_livreur and y.retiree_le is null))
          or (l.retiree_le is null and o.statut in ('refusee', 'annulee')))
    ), '[]'::jsonb)
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
      -- Commande au téléphone sans e-mail : pas une fiche client (un client est une adresse e-mail).
      and btrim(o.client_email) <> ''
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

-- p : la même forme que pour creer_commande (statut « nouvelle », « a_encaisser_retrait », « comptoir »).
-- Crée la commande, la marque « telephone », l'accepte pour p_heure au nom de l'équipier et le journalise.
-- Même clé d'idempotence rejouée : rend la commande déjà créée (deja), sans l'accepter une seconde fois.
create function creer_commande_telephone(p jsonb, p_heure timestamptz, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  pe personnel%rowtype;
  r record;
  par text;
begin
  select * into pe from personnel where id = p_personnel and actif and role in ('service', 'gerant', 'responsable');
  if not found then
    raise exception 'personnel_inactif';
  end if;
  if p ->> 'statut' is distinct from 'nouvelle' or p ->> 'moyen_paiement' is distinct from 'comptoir'
     or p ->> 'statut_paiement' is distinct from 'a_encaisser_retrait' then
    raise exception 'commande_invalide';
  end if;
  if p_heure is null then
    raise exception 'heure_manquante';
  end if;
  par := 'tablette:' || pe.nom;
  perform set_config('laferme.canal', 'telephone', true);
  select * into r from creer_commande(p);
  perform set_config('laferme.canal', '', true);
  if r.deja then
    return jsonb_build_object('id', r.id, 'numero', r.numero, 'jeton_suivi', r.jeton_suivi, 'deja', true);
  end if;
  update commandes set canal = 'telephone' where id = r.id;
  if not changer_statut(r.id, 'acceptee', par, p_heure, null, 'nouvelle') then
    raise exception 'acceptation_impossible';
  end if;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    values (r.id, 'acceptee', 'acceptee', par, 'prise au téléphone');
  -- Journal du back-office au nom de l'équipier (journaliser exige un gérant). Sans nom ni téléphone du client.
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, pe.nom, 'commande_telephone', r.id::text, null,
      jsonb_build_object('numero', r.numero, 'mode', p ->> 'mode', 'total_centimes', (p ->> 'total_centimes')::integer));
  return jsonb_build_object('id', r.id, 'numero', r.numero, 'jeton_suivi', r.jeton_suivi, 'deja', false);
end;
$$;

revoke execute on function creer_commande_telephone(jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function creer_commande_telephone(jsonb, timestamptz, uuid) to service_role;
