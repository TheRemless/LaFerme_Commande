-- Manque signalé à la tablette : rendre par le moyen qui a encaissé (décision du chef du 15.11.2026), comme
-- « Changer les plats » au back-office (#257, moyen « terminal » des remboursements, 20261216140000). Une commande
-- encaissée par carte au comptoir ou à la porte se rend sur le terminal, en espèces sinon. Proposé par défaut,
-- changeable (p_moyen), le choix et le moyen proposé notés au journal de la commande.
-- signaler_manque (20261124090000) recréée à l'identique sauf le moyen ; un paramètre de plus (facultatif), donc
-- supprimée puis créée. Elle est désormais réservée à la clé de service, comme les fonctions récentes.
-- Numéro donné par le chef.

drop function signaler_manque(uuid, jsonb, text, uuid, boolean);

create function signaler_manque(p_commande uuid, p_elements jsonb, p_cle text, p_personnel uuid, p_confirmer boolean, p_moyen text default null) returns jsonb
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
  moyen_propose text;
  moyen_rendu text;
begin
  if p_moyen is not null and p_moyen not in ('especes', 'terminal') then
    raise exception 'moyen_invalide';
  end if;
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
  -- Rendre par le moyen qui a encaissé (décision du chef du 15.11.2026, comme « Changer les plats », #257) : payée en
  -- ligne, Stripe ; encaissée par carte au comptoir ou à la porte, le terminal ; en espèces, en espèces ; pas encore
  -- encaissée, déduit. Le moyen proposé se change (client qui préfère des espèces), le choix est noté au journal.
  moyen_propose := case when c.moyen_paiement = 'en_ligne' then 'stripe'
    when c.statut_paiement = 'encaisse' then case when c.moyen_comptoir = 'carte' then 'terminal' else 'especes' end
    else 'deduction' end;
  moyen_rendu := case when moyen_propose in ('especes', 'terminal') then coalesce(p_moyen, moyen_propose) else moyen_propose end;
  if not p_confirmer then
    return jsonb_build_object('montant_centimes', montant, 'description', array_to_string(parties, ', '), 'numero', c.numero,
      'moyen', moyen_rendu, 'moyen_propose', moyen_propose);
  end if;
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le, elements, montants_lignes)
  values (p_commande, p_cle, montant, left(m, 200),
    moyen_rendu,
    case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
    p_personnel, auteur,
    case when c.moyen_paiement = 'en_ligne' then null else now() end,
    p_elements, ce_geste)
  returning * into r;
  insert into evenements_commande (commande_id, de, vers, par, detail)
  values (p_commande, null, 'manque', 'tablette:' || auteur, (montant / 100.0)::numeric(10, 2)::text || ' CHF, ' || array_to_string(parties, ', ')
    || case moyen_rendu when 'terminal' then ', rendu sur le terminal' when 'especes' then ', rendu en espèces' else '' end
    || case when moyen_rendu <> moyen_propose then ' (proposé : ' || case moyen_propose when 'terminal' then 'terminal' else 'espèces' end || ')' else '' end);
  if r.statut = 'fait' and c.statut_paiement = 'encaisse' then
    perform maj_rembourse(p_commande);
  end if;
  return to_jsonb(r) || jsonb_build_object('deja', false, 'description', array_to_string(parties, ', '), 'numero', c.numero);
end;
$$;

revoke all on function signaler_manque(uuid, jsonb, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function signaler_manque(uuid, jsonb, text, uuid, boolean, text) to service_role;
