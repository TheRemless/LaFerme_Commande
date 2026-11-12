-- S2-13 (audit sécurité 2) : un manque signalé depuis la tablette remboursait un supplément au prix du jour.
-- Supplément à CHF 3 à la commande, passé à CHF 8 : sur une ligne de 4 plats, CHF 32 rendus au lieu de 12.
--
-- 1. Chaque ligne garde le prix payé de ses options (commande_lignes.prix_choix, rempli par creer_commande
--    depuis le calcul du panier) : { "groupe": { "option": centimes par plat } }.
-- 2. signaler_manque relit ce prix. Pour une ligne sans prix figé (commande d'avant cette migration), il
--    reprend le prix du jour.
-- 3. Toute ligne est plafonnée par son total moins ce qui en a déjà été rendu. Chaque manque garde ce qu'il
--    rend par ligne (remboursements.montants_lignes). Un manque d'avant cette migration compte en entier
--    pour chaque ligne qu'il touche : plus prudent, jamais plus généreux.
--
-- Objets partagés recréés : creer_commande (repris de 20261113090000_correctifs_service.sql, seul ajout :
-- prix_choix) et signaler_manque (repris de 20261117090000_gerant_vague2.sql). Aucun UPDATE ni DELETE.
-- Compatible dans les deux sens : l'ancien code n'envoie pas prix_choix (ligne traitée comme ancienne),
-- le nouveau code sur une base pas encore migrée envoie une clé que l'ancienne fonction ignore.

alter table commande_lignes add column prix_choix jsonb;
alter table remboursements add column montants_lignes jsonb;

-- Prix d'une option pour un plat de la ligne : prix figé s'il existe, sinon prix du jour, sinon 0.
create function prix_option_paye(p_prix_choix jsonb, p_groupe text, p_nom text) returns integer
language sql stable as $$
  select coalesce(
    case when jsonb_typeof(p_prix_choix -> p_groupe -> p_nom) = 'number'
      then greatest(round((p_prix_choix -> p_groupe ->> p_nom)::numeric), 0)::integer end,
    (select o.prix_centimes from options o join groupes_options g on g.id = o.groupe_id where g.slug = p_groupe and o.nom = p_nom),
    0
  );
$$;

-- Même fonction qu'en 20261113090000_correctifs_service.sql, plus : prix_choix enregistré avec la ligne.
create or replace function creer_commande(p jsonb) returns table (id uuid, numero integer, jeton_suivi text, deja boolean)
language plpgsql as $$
declare
  existante commandes%rowtype;
  aujourd_hui date := (now() at time zone 'Europe/Zurich')::date;
  service date;
  n integer;
  nouvelle_id uuid;
  cid uuid := (p ->> 'compte_id')::uuid;
begin
  perform pg_advisory_xact_lock(hashtext('commande:' || (p ->> 'cle_idempotence')));
  select * into existante from commandes c where c.cle_idempotence = p ->> 'cle_idempotence';
  if found then
    return query select existante.id, existante.numero, existante.jeton_suivi, true;
    return;
  end if;
  service := case when p ->> 'quand_type' = 'creneau' then (p ->> 'quand_date')::date else aujourd_hui end;
  if p ->> 'quand_type' = 'creneau' then
    perform pg_advisory_xact_lock(hashtext('creneau:' || (p ->> 'quand_date') || ':' || (p ->> 'quand_minutes') || ':' || (p ->> 'mode')));
    if creneau_plein((p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, p ->> 'mode') then
      raise exception 'creneau_complet';
    end if;
  end if;
  insert into compteurs_jour as cj (jour, dernier) values (service, 1)
    on conflict (jour) do update set dernier = cj.dernier + 1
    returning cj.dernier into n;
  insert into commandes (
    numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
    client_prenom, client_nom, client_telephone, client_email, adresse, details_livraison, zone_numero,
    quand_type, quand_date, quand_minutes, pizzas_seulement,
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine,
    compte_id, compte_demande
  ) values (
    n, aujourd_hui, service, p ->> 'jeton_suivi', p ->> 'cle_idempotence', p ->> 'mode', p ->> 'statut', p ->> 'statut_paiement', p ->> 'moyen_paiement',
    p ->> 'client_prenom', p ->> 'client_nom', p ->> 'client_telephone', p ->> 'client_email', p -> 'adresse', p -> 'details_livraison',
    (p ->> 'zone_numero')::smallint,
    p ->> 'quand_type', (p ->> 'quand_date')::date, (p ->> 'quand_minutes')::smallint, (p ->> 'pizzas_seulement')::boolean,
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, (p ->> 'taux_tva_pourcent')::numeric, p ->> 'origine',
    cid, coalesce((p ->> 'compte_demande')::boolean, false) and cid is null
  ) returning commandes.id into nouvelle_id;
  insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, retraits, note, prix_choix)
  select nouvelle_id, (l.ordinality - 1)::smallint, l.v ->> 'slug', l.v ->> 'nom', (l.v ->> 'station')::station, (l.v ->> 'qte')::smallint,
         (l.v ->> 'unitaire_centimes')::integer, (l.v ->> 'total_centimes')::integer, l.v -> 'choix', l.v -> 'retraits', coalesce(l.v ->> 'note', ''),
         case when jsonb_typeof(l.v -> 'prix_choix') = 'object' then l.v -> 'prix_choix' end
  from jsonb_array_elements(p -> 'lignes') with ordinality as l(v, ordinality);
  if cid is not null then
    perform completer_depuis_commande(cid, nouvelle_id);
  end if;
  return query select nouvelle_id, n, p ->> 'jeton_suivi', false;
end;
$$;

-- Même fonction qu'en 20261117090000_gerant_vague2.sql, plus : prix payé des suppléments (prix_option_paye)
-- et plafond par ligne (montants_lignes).
create or replace function signaler_manque(p_commande uuid, p_elements jsonb, p_cle text, p_personnel uuid, p_confirmer boolean) returns jsonb
language plpgsql as $$
declare
  auteur text;
  role_auteur text;
  c commandes%rowtype;
  r remboursements%rowtype;
  e jsonb;
  l commande_lignes%rowtype;
  prec jsonb;
  qte_deja integer;
  opts_deja integer;
  calcul integer;
  reste integer;
  part integer;
  deja_lignes jsonb;
  ce_geste jsonb := '{}'::jsonb;
  montant integer := 0;
  parties text[] := '{}';
  engage integer;
  m text;
begin
  select nom, role into auteur, role_auteur from personnel where id = p_personnel and actif;
  if auteur is null then
    raise exception 'personnel_inactif';
  end if;
  if p_cle is null or length(p_cle) not between 8 and 80 then
    raise exception 'cle_invalide';
  end if;
  if p_confirmer then
    perform pg_advisory_xact_lock(hashtext('remboursement:' || p_cle));
    select * into r from remboursements where cle = p_cle;
    if found then
      if r.commande_id <> p_commande or r.elements is distinct from p_elements then
        raise exception 'cle_reutilisee';
      end if;
      return to_jsonb(r) || jsonb_build_object('deja', true, 'description', substr(r.motif, 10), 'numero', (select numero from commandes where id = p_commande));
    end if;
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    raise exception 'commande_inconnue';
  end if;
  if c.statut not in ('acceptee', 'en_preparation', 'prete', 'partie') then
    raise exception 'statut_non_remboursable';
  end if;
  -- Même limite que l'annulation depuis la tablette : une fois prête ou partie, seul le gérant rend de l'argent.
  if c.statut in ('prete', 'partie') and role_auteur <> 'gerant' then
    raise exception 'reserve_au_gerant';
  end if;
  if c.statut_paiement not in ('paye', 'encaisse', 'a_encaisser_retrait') then
    raise exception 'pas_encaissee';
  end if;
  if jsonb_typeof(p_elements) <> 'array' or jsonb_array_length(p_elements) not between 1 and 30 then
    raise exception 'elements_invalides';
  end if;
  -- Ce qui a déjà été signalé (en cours ou fait) sur cette commande.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into prec
  from remboursements rb, jsonb_array_elements(rb.elements) x
  where rb.commande_id = p_commande and rb.statut in ('en_cours', 'fait') and rb.elements is not null;
  -- Déjà rendu par ligne : le détail gardé par chaque manque ; un manque d'avant S2-13 (sans détail) compte
  -- en entier pour chaque ligne qu'il touche.
  select coalesce(jsonb_object_agg(d.pos, d.s), '{}'::jsonb) into deja_lignes
  from (
    select pos, sum(v)::integer as s
    from (
      select k.key as pos, (k.value #>> '{}')::integer as v
      from remboursements rb, jsonb_each(rb.montants_lignes) k
      where rb.commande_id = p_commande and rb.statut in ('en_cours', 'fait') and jsonb_typeof(rb.montants_lignes) = 'object'
      union all
      select t.pos, t.montant_centimes
      from (
        select distinct rb.id, x ->> 'ligne' as pos, rb.montant_centimes
        from remboursements rb, jsonb_array_elements(rb.elements) x
        where rb.commande_id = p_commande and rb.statut in ('en_cours', 'fait') and rb.elements is not null and rb.montants_lignes is null
      ) t
    ) u
    group by pos
  ) d;
  for e in select * from jsonb_array_elements(p_elements) loop
    select * into l from commande_lignes where commande_id = p_commande and position = (e ->> 'ligne')::smallint;
    if not found then
      raise exception 'ligne_inconnue';
    end if;
    -- Plats de la ligne déjà signalés, et prix payé des suppléments de la ligne déjà rendus (par plat).
    select coalesce(sum((x ->> 'qte')::integer), 0) into qte_deja from jsonb_array_elements(prec) x
    where (x ->> 'ligne')::integer = l.position and coalesce(x ->> 'groupe', '') = '';
    select coalesce(sum(prix_option_paye(l.prix_choix, x ->> 'groupe', x ->> 'nom')), 0) into opts_deja
    from jsonb_array_elements(prec) x
    where (x ->> 'ligne')::integer = l.position and coalesce(x ->> 'groupe', '') <> '';
    if coalesce(e ->> 'groupe', '') = '' then
      -- Le plat entier : prix de la ligne, suppléments compris, moins les suppléments déjà rendus.
      if (e ->> 'qte')::integer is null or (e ->> 'qte')::integer < 1 then
        raise exception 'elements_invalides';
      end if;
      if qte_deja + (e ->> 'qte')::integer > l.qte then
        raise exception 'deja_signale';
      end if;
      prec := prec || jsonb_build_array(e);
      calcul := greatest(l.unitaire_centimes - opts_deja, 0) * (e ->> 'qte')::integer;
      parties := parties || ((e ->> 'qte') || ' × ' || l.nom);
    else
      -- Un supplément choisi sur la ligne : son prix payé, pour chaque plat de la ligne pas encore rendu.
      if not coalesce(l.choix -> (e ->> 'groupe') ? (e ->> 'nom'), false) then
        raise exception 'option_absente';
      end if;
      if qte_deja >= l.qte or exists (select 1 from jsonb_array_elements(prec) x
          where (x ->> 'ligne')::integer = l.position and x ->> 'groupe' = e ->> 'groupe' and x ->> 'nom' = e ->> 'nom') then
        raise exception 'deja_signale';
      end if;
      prec := prec || jsonb_build_array(e);
      calcul := prix_option_paye(l.prix_choix, e ->> 'groupe', e ->> 'nom') * (l.qte - qte_deja);
      parties := parties || ((e ->> 'nom') || ' sur ' || (l.qte - qte_deja) || ' × ' || l.nom);
    end if;
    -- Plafond de la ligne : son total moins ce qui en a déjà été rendu, avant et dans ce geste.
    reste := l.total_centimes - coalesce((deja_lignes ->> l.position::text)::integer, 0) - coalesce((ce_geste ->> l.position::text)::integer, 0);
    part := least(calcul, greatest(reste, 0));
    ce_geste := jsonb_set(ce_geste, array[l.position::text], to_jsonb(coalesce((ce_geste ->> l.position::text)::integer, 0) + part));
    montant := montant + part;
  end loop;
  -- Le total de la commande borne toujours (un détail par ligne plus haut que le montant reste prudent).
  select coalesce(sum(montant_centimes), 0) into engage from remboursements where commande_id = p_commande and statut in ('en_cours', 'fait');
  montant := least(montant, c.total_centimes - engage);
  if montant <= 0 then
    raise exception 'montant_trop_eleve';
  end if;
  m := 'Manque : ' || array_to_string(parties, ', ');
  if not p_confirmer then
    return jsonb_build_object('montant_centimes', montant, 'description', array_to_string(parties, ', '), 'numero', c.numero);
  end if;
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le, elements, montants_lignes)
  values (p_commande, p_cle, montant, left(m, 200),
    case when c.moyen_paiement = 'en_ligne' then 'stripe' when c.statut_paiement = 'encaisse' then 'especes' else 'deduction' end,
    case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
    p_personnel, auteur,
    case when c.moyen_paiement = 'en_ligne' then null else now() end,
    p_elements, ce_geste)
  returning * into r;
  insert into evenements_commande (commande_id, de, vers, par, detail)
  values (p_commande, null, 'manque', 'tablette:' || auteur, (montant / 100.0)::numeric(10, 2)::text || ' CHF, ' || array_to_string(parties, ', '));
  if r.statut = 'fait' and c.statut_paiement = 'encaisse' then
    perform maj_rembourse(p_commande);
  end if;
  return to_jsonb(r) || jsonb_build_object('deja', false, 'description', array_to_string(parties, ', '), 'numero', c.numero);
end;
$$;

revoke execute on function prix_option_paye(jsonb, text, text) from public, anon, authenticated;
grant execute on function prix_option_paye(jsonb, text, text) to service_role;
