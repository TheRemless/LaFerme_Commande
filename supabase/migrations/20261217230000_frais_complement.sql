-- Frais par taux dans la ventilation d'un complément (demande de bo-pilotage du 19.11.2026, après #276). Numéro donné
-- par le chef.
--
-- Avant : complements.ventilation donnait taux, ttc et tva ; bo-pilotage mettait les frais d'un complément
-- (k.frais_centimes) sur sa plus grande part positive, par déduction. Maintenant chaque part dit aussi frais_ttc et
-- frais_tva : la part des frais de livraison à ce taux, comprise dans ttc, comme dans ventilation_commande.
--   ventilation_brute garde les frais de chaque taux (ventilation_lignes) ; ventilation_difference en fait la
--   différence, signée (des frais qui baissent donnent une part négative) ; modifications_commande.ventilation et
--   complements.ventilation la portent. Un complément ramené par une baisse garde ses frais au prorata
--   (ventilation_frais_ramenes, plafonnés comme k.frais_centimes).
--   ventilation_complement rend [{ taux, ttc, tva, frais_ttc, frais_tva }] ; pour un complément ventilé avant cette
--   migration, les frais restent sur la plus grande part, comme bo-pilotage les lisait.
--   La somme des frais_ttc d'un complément vaut la différence de frais, signée ; k.frais_centimes reste la part
--   positive (inchangé), pour les lecteurs d'avant.
-- Objets recréés depuis leur dernière définition (20261217190000_ventilation_figee.sql) : ventilation_brute,
-- ventilation_difference, ventilation_complement, appliquer_modification.

create or replace function ventilation_brute(p_commande uuid, p_frais integer) returns jsonb
language plpgsql stable as $$
declare
  o commandes%rowtype;
begin
  select * into o from commandes where id = p_commande;
  o.ventilation_figee := null;
  o.remise_centimes := 0;
  o.cagnotte_centimes := 0;
  o.code_promo := null;
  o.frais_centimes := p_frais;
  o.total_centimes := (select coalesce(sum(total_centimes), 0) from commande_lignes where commande_id = p_commande)::integer + p_frais;
  return (select coalesce(jsonb_agg(jsonb_build_object('taux', (x ->> 'taux')::numeric, 'ttc', (x ->> 'ttc')::integer,
      'frais_ttc', coalesce((x ->> 'frais_ttc')::integer, 0))), '[]'::jsonb)
    from jsonb_array_elements(ventilation_lignes(o)) x);
end;
$$;

-- Après moins avant, par taux, parts non nulles seulement, TVA de chaque part (signée) ; frais_ttc et frais_tva : la
-- part des frais de livraison à ce taux (comprise dans ttc), signée elle aussi.
create or replace function ventilation_difference(p_avant jsonb, p_apres jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('taux', d.taux, 'ttc', d.ttc, 'tva', round(d.ttc * d.taux / (100 + d.taux))::integer,
      'frais_ttc', d.frais, 'frais_tva', round(d.frais * d.taux / (100 + d.taux))::integer) order by d.taux), '[]'::jsonb)
  from (
    select t.taux, sum(t.ttc)::integer as ttc, sum(t.frais)::integer as frais
    from (
      select (x ->> 'taux')::numeric as taux, (x ->> 'ttc')::integer as ttc, coalesce((x ->> 'frais_ttc')::integer, 0) as frais
        from jsonb_array_elements(coalesce(p_apres, '[]'::jsonb)) x
      union all
      select (x ->> 'taux')::numeric, -(x ->> 'ttc')::integer, -coalesce((x ->> 'frais_ttc')::integer, 0)
        from jsonb_array_elements(coalesce(p_avant, '[]'::jsonb)) x
    ) t
    group by t.taux
  ) d
  where d.ttc <> 0 or d.frais <> 0;
$$;

-- Contrat avec bo-pilotage : [{ taux, ttc, tva, frais_ttc, frais_tva }] d'un complément, frais compris dans ttc.
-- Sans ventilation (compléments d'avant), un seul taux, celui de la commande, la TVA et les frais notés sur le complément.
-- Une ventilation d'avant cette migration (sans frais par part) : les frais du complément sur sa plus grande part,
-- comme le lisait bo-pilotage.
create or replace function ventilation_complement(k complements) returns jsonb
language sql stable as $$
  select case
    when k.ventilation is null then
      (select jsonb_build_array(jsonb_build_object('taux', o.taux_tva_pourcent, 'ttc', k.montant_centimes, 'tva', k.tva_centimes,
         'frais_ttc', k.frais_centimes, 'frais_tva', round(k.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer))
       from commandes o where o.id = k.commande_id)
    when exists (select 1 from jsonb_array_elements(k.ventilation) x where x ? 'frais_ttc') then
      (select coalesce(jsonb_agg(jsonb_build_object('taux', (x ->> 'taux')::numeric, 'ttc', (x ->> 'ttc')::integer, 'tva', (x ->> 'tva')::integer,
         'frais_ttc', coalesce((x ->> 'frais_ttc')::integer, 0), 'frais_tva', coalesce((x ->> 'frais_tva')::integer, 0))
         order by (x ->> 'taux')::numeric), '[]'::jsonb) from jsonb_array_elements(k.ventilation) x)
    else
      (select coalesce(jsonb_agg(jsonb_build_object('taux', y.taux, 'ttc', y.ttc, 'tva', y.tva,
         'frais_ttc', case when y.rang = 1 then k.frais_centimes else 0 end,
         'frais_tva', case when y.rang = 1 then round(k.frais_centimes * y.taux / (100 + y.taux))::integer else 0 end) order by y.taux), '[]'::jsonb)
       from (select (x ->> 'taux')::numeric as taux, (x ->> 'ttc')::integer as ttc, (x ->> 'tva')::integer as tva,
               row_number() over (order by (x ->> 'ttc')::integer desc, (x ->> 'taux')::numeric desc) as rang
             from jsonb_array_elements(k.ventilation) x) y)
  end;
$$;

-- Une ventilation ramenée (ventilation_ramenee) reprend la part des frais à chaque taux, ramenée à p_frais au prorata
-- des frais d'avant (parts signées). Sans frais d'avant, rien.
create or replace function ventilation_frais_ramenes(p_avant jsonb, p_ramenee jsonb, p_frais integer) returns jsonb
language plpgsql immutable as $$
declare
  taux numeric[];
  poids integer[];
  parts integer[];
  res jsonb := '[]'::jsonb;
  x jsonb;
  i integer;
  f integer;
begin
  select coalesce(array_agg((y ->> 'taux')::numeric order by (y ->> 'taux')::numeric), '{}'),
         coalesce(array_agg(coalesce((y ->> 'frais_ttc')::integer, 0) order by (y ->> 'taux')::numeric), '{}')
    into taux, poids from jsonb_array_elements(coalesce(p_avant, '[]'::jsonb)) y;
  if coalesce(array_length(poids, 1), 0) = 0 or (select coalesce(sum(v), 0) from unnest(poids) v) = 0 then
    return p_ramenee;
  end if;
  parts := repartir_signe(coalesce(p_frais, 0), poids);
  for x in select * from jsonb_array_elements(coalesce(p_ramenee, '[]'::jsonb)) loop
    f := 0;
    for i in 1 .. array_length(taux, 1) loop
      if taux[i] = (x ->> 'taux')::numeric then
        f := parts[i];
      end if;
    end loop;
    res := res || (x || jsonb_build_object('frais_ttc', f,
      'frais_tva', round(f * (x ->> 'taux')::numeric / (100 + (x ->> 'taux')::numeric))::integer));
  end loop;
  return res;
end;
$$;

create or replace function appliquer_modification(p_modification uuid, p_evenement text default null, p_payment_intent text default null, p_montant integer default null)
returns jsonb
language plpgsql as $$
declare
  m modifications_commande%rowtype;
  c commandes%rowtype;
  rb remboursements%rowtype;
  k complements%rowtype;
  i integer := 0;
  l jsonb;
  engage integer;
  reste integer;
  x complements%rowtype;
  frais_avant integer;
  du_avant integer;
  du_apres integer;
  reduction integer;
  nouveau_total integer;
  remboursable integer;
  voulu integer := 0;
  rembourse integer := 0;
  rembs jsonb := '[]'::jsonb;
  y record;
  part integer;
  r2 remboursements%rowtype;
  brut_avant jsonb;
  ventil jsonb;
  payee boolean;
  w jsonb;
begin
  select * into m from modifications_commande where id = p_modification for update;
  if not found or m.statut in ('appliquee', 'payee_non_appliquee') then
    return jsonb_build_object('applique', false, 'raison', 'deja');
  end if;
  if m.statut = 'abandonnee' then
    -- Lien payé après l'abandon (le client payait au moment où l'équipe renonçait, ou la session n'a pas pu être
    -- fermée) : l'argent est reçu sans modification. Noté une fois, et le gérant est alerté (src/lib/difference.ts).
    if m.reglement = 'lien' and p_evenement is not null then
      insert into evenements_paiement (id, commande_id, type) values (p_evenement, m.commande_id, 'complement') on conflict (id) do nothing;
      if not found then
        return jsonb_build_object('applique', false, 'raison', 'deja');
      end if;
      update modifications_commande set statut = 'payee_non_appliquee', stripe_payment_intent = p_payment_intent, fini_le = now() where id = m.id;
      return jsonb_build_object('applique', false, 'raison', 'abandonnee_payee', 'a_rembourser', true, 'commande_id', m.commande_id,
        'numero', (select numero from commandes where id = m.commande_id), 'montant_centimes', p_montant);
    end if;
    return jsonb_build_object('applique', false, 'raison', 'deja');
  end if;
  if m.reglement = 'lien' then
    if p_evenement is null then
      return jsonb_build_object('applique', false, 'raison', 'paiement_attendu');
    end if;
    insert into evenements_paiement (id, commande_id, type) values (p_evenement, m.commande_id, 'complement') on conflict (id) do nothing;
    if not found then
      return jsonb_build_object('applique', false, 'raison', 'deja');
    end if;
    if p_montant is distinct from m.difference_centimes then
      return jsonb_build_object('applique', false, 'raison', 'montant', 'commande_id', m.commande_id,
        'numero', (select numero from commandes where id = m.commande_id), 'montant_centimes', p_montant);
    end if;
  end if;
  select * into c from commandes where id = m.commande_id for update;
  if c.statut not in ('nouvelle', 'acceptee', 'en_preparation', 'prete') then
    -- Payé par le lien alors que la commande est partie, finie ou annulée : l'argent est là, la modification ne
    -- s'applique pas. Le gérant le voit et rembourse (src/lib/difference.ts l'alerte).
    update modifications_commande set statut = case when m.reglement = 'lien' then 'payee_non_appliquee' else 'abandonnee' end,
      stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent), fini_le = now() where id = m.id;
    return jsonb_build_object('applique', false, 'raison', 'commande_finie', 'a_rembourser', m.reglement = 'lien',
      'commande_id', c.id, 'numero', c.numero, 'montant_centimes', p_montant);
  end if;

  frais_avant := frais_commande(c.id);
  -- Réduction du départ (code promo, cagnotte…) : valeur des plats et frais moins le total. Gardée sur le nouveau total.
  reduction := greatest(valeur_commande(c.id) - c.total_centimes, 0);
  -- Ventilation figée : une commande payée garde la ventilation de sa vente d'origine ; la modification a la sienne,
  -- montants bruts par taux (lignes et frais) après moins avant, parts signées, somme = différence.
  payee := c.statut_paiement in ('paye', 'encaisse');
  -- Payée sans passer par le déclencheur (créée déjà payée) : figée au plus tard ici, avant de toucher aux lignes.
  if payee and c.ventilation_figee is null then
    update commandes set ventilation_figee = ventilation_commande(c) where id = c.id;
  end if;
  brut_avant := ventilation_brute(c.id, frais_avant);
  -- R21 (Olico, rien d'effaçable) : l'état d'avant reste sur la modification, lignes, commande et compléments dus.
  update modifications_commande set
    lignes_avant = (select coalesce(jsonb_agg(to_jsonb(la) - 'id' - 'commande_id' order by la.position), '[]'::jsonb)
      from commande_lignes la where la.commande_id = c.id),
    commande_avant = jsonb_build_object('adresse', c.adresse, 'details_livraison', c.details_livraison, 'zone_numero', c.zone_numero,
      'pizzas_seulement', c.pizzas_seulement, 'sous_total_centimes', c.sous_total_centimes, 'frais_centimes', c.frais_centimes,
      'total_centimes', c.total_centimes, 'tva_centimes', c.tva_centimes),
    complements_avant = (select coalesce(jsonb_agg(jsonb_build_object('id', k2.id, 'montant_centimes', k2.montant_centimes,
      'tva_centimes', k2.tva_centimes, 'frais_centimes', k2.frais_centimes, 'moyen', k2.moyen, 'statut', k2.statut) order by k2.cree_le), '[]'::jsonb)
      from complements k2 where k2.commande_id = c.id and k2.statut = 'a_encaisser')
  where id = m.id;
  -- R16 : un plat offert reste dans la commande, la même ligne (le geste la désigne), à 0 CHF, quoi que le client change.
  delete from commande_lignes where commande_id = c.id and not offert;
  for l in select * from jsonb_array_elements(m.lignes) loop
    i := i + 1;
    insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, prix_choix, retraits, note, pour)
    values (c.id, i, l ->> 'slug', l ->> 'nom', (l ->> 'station')::station, (l ->> 'qte')::smallint, (l ->> 'unitaire_centimes')::integer,
      (l ->> 'total_centimes')::integer, coalesce(l -> 'choix', '{}'::jsonb), l -> 'prix_choix', coalesce(l -> 'retraits', '[]'::jsonb),
      coalesce(l ->> 'note', ''), coalesce(l ->> 'pour', ''));
  end loop;
  -- Les lignes offertes passent après les nouvelles lignes.
  update commande_lignes lo set position = i + q.rang
    from (select id, row_number() over (order by position) as rang from commande_lignes where commande_id = c.id and offert) q
    where lo.id = q.id;
  if payee then
    ventil := ventilation_difference(brut_avant, ventilation_brute(c.id, m.frais_centimes));
    update modifications_commande set ventilation = ventil where id = m.id;
  end if;
  update commandes set
    adresse = coalesce(m.adresse, adresse),
    details_livraison = coalesce(m.details_livraison, details_livraison),
    zone_numero = coalesce(m.zone_numero, zone_numero),
    -- Une ligne offerte hors pizza (gardée par la modification) compte aussi.
    pizzas_seulement = m.pizzas_seulement and not exists (select 1 from commande_lignes lo where lo.commande_id = c.id and lo.offert and lo.station <> 'pizza')
  where id = c.id;
  -- Pas encore payée : le client paie le nouveau total au retrait ou à la livraison.
  if c.statut_paiement = 'a_encaisser_retrait' then
    nouveau_total := greatest(m.total_centimes - reduction, 0);
    update commandes set sous_total_centimes = m.sous_total_centimes, frais_centimes = m.frais_centimes,
      total_centimes = nouveau_total,
      tva_centimes = round(nouveau_total * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer
    where id = c.id;
  end if;

  if m.reglement in ('lien', 'porte', 'comptoir') then
    insert into complements (commande_id, modification_id, montant_centimes, tva_centimes, frais_centimes, moyen, statut, moyen_encaissement, stripe_payment_intent, encaisse_le, encaisse_par)
    values (c.id, m.id, m.difference_centimes,
      coalesce((select sum((vv ->> 'tva')::integer) from jsonb_array_elements(ventil) vv)::integer,
        round(m.difference_centimes * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer),
      least(greatest(m.frais_centimes - frais_avant, 0), m.difference_centimes),
      case when m.reglement = 'lien' then 'en_ligne' else m.reglement end,
      case when m.reglement = 'lien' then 'encaisse' else 'a_encaisser' end,
      case when m.reglement = 'lien' then 'stripe' end, p_payment_intent,
      case when m.reglement = 'lien' then now() end, case when m.reglement = 'lien' then 'stripe' end)
    returning * into k;
    if ventil is not null then
      update complements set ventilation = ventil where id = k.id returning * into k;
    end if;
  elsif m.reglement = 'remboursement' then
    -- Un complément encore à encaisser (porte, comptoir) se réduit d'abord : on ne rembourse pas ce qui n'est pas payé.
    reste := -m.difference_centimes;
    select coalesce(sum(montant_centimes), 0) into du_avant from complements where commande_id = c.id and statut = 'a_encaisser';
    for x in select * from complements where commande_id = c.id and statut = 'a_encaisser' order by cree_le desc for update loop
      exit when reste <= 0;
      if x.montant_centimes <= reste then
        -- R21 : annulé, jamais supprimé ; son montant reste celui d'avant, la modification qui l'annule est notée.
        update complements set statut = 'annule', annule_le = now(), annule_par_modification = m.id where id = x.id;
        reste := reste - x.montant_centimes;
      else
        -- Ventilé : ramené au nouveau montant, au prorata de ses parts.
        w := case when x.ventilation is not null
          then ventilation_frais_ramenes(x.ventilation, ventilation_ramenee(x.ventilation, x.montant_centimes - reste),
            least(x.frais_centimes, x.montant_centimes - reste)) end;
        update complements set montant_centimes = x.montant_centimes - reste,
          tva_centimes = coalesce((select sum((v ->> 'tva')::integer) from jsonb_array_elements(w) v)::integer,
            round((x.montant_centimes - reste) * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer),
          frais_centimes = least(x.frais_centimes, x.montant_centimes - reste), ventilation = w
        where id = x.id;
        reste := 0;
      end if;
    end loop;
    select coalesce(sum(montant_centimes), 0) into du_apres from complements where commande_id = c.id and statut = 'a_encaisser';
    -- Ce qui reste du paiement de départ (les remboursements sur son payment intent), puis les compléments payés par
    -- le lien. Une remise ou une cagnotte n'est jamais rendue en argent.
    voulu := reste;
    select coalesce(sum(montant_centimes), 0) into engage from remboursements
      where commande_id = c.id and statut in ('fait', 'en_cours') and payment_intent_cible is null and complement_id is null;
    remboursable := greatest(c.total_centimes - engage, 0);
    part := least(reste, remboursable);
    reste := reste - part;
    if part > 0 then
    insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le, modification_id)
    values (c.id, 'modification-' || m.id, part, 'Commande modifiée à la demande du client',
      case when c.moyen_paiement = 'en_ligne' then 'stripe'
        else coalesce(m.moyen_remboursement, case when c.moyen_comptoir = 'carte' then 'terminal' else 'especes' end) end,
      case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
      m.personnel_id, m.personnel_nom, case when c.moyen_paiement = 'en_ligne' then null else now() end, m.id)
    returning * into rb;
    rembourse := rembourse + part;
    rembs := rembs || jsonb_build_array(to_jsonb(rb));
    end if;
    -- Au-delà : sur le paiement de chaque complément payé par le lien, dans la limite de ce qui en reste.
    for y in select kc.id, kc.stripe_payment_intent, kc.montant_centimes - coalesce((select sum(rr.montant_centimes) from remboursements rr
        where rr.complement_id = kc.id and rr.statut in ('fait', 'en_cours')), 0) as dispo
      from complements kc
      where kc.commande_id = c.id and kc.moyen = 'en_ligne' and kc.statut = 'encaisse' and kc.rembourse_le is null
        and kc.stripe_payment_intent is not null
      order by kc.cree_le loop
      exit when reste <= 0;
      part := least(reste, y.dispo);
      continue when part <= 0;
      insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, payment_intent_cible, complement_id, modification_id)
      values (c.id, 'modification-' || m.id || '-c' || left(y.id::text, 8), part, 'Commande modifiée à la demande du client', 'stripe', 'en_cours',
        m.personnel_id, m.personnel_nom, y.stripe_payment_intent, y.id, m.id)
      returning * into r2;
      rembs := rembs || jsonb_build_array(to_jsonb(r2));
      rembourse := rembourse + part;
      reste := reste - part;
    end loop;
    -- Puis chaque complément encaissé à la porte ou au comptoir (relecture de bo-pilotage) : rendu tout de suite par
    -- l'équipe, par le moyen choisi, sinon celui qui a encaissé le complément.
    for y in select kc.id, kc.moyen_encaissement, kc.montant_centimes - coalesce((select sum(rr.montant_centimes) from remboursements rr
        where rr.complement_id = kc.id and rr.statut in ('fait', 'en_cours')), 0) as dispo
      from complements kc
      where kc.commande_id = c.id and kc.moyen in ('porte', 'comptoir') and kc.statut = 'encaisse' and kc.rembourse_le is null
      order by kc.cree_le loop
      exit when reste <= 0;
      part := least(reste, y.dispo);
      continue when part <= 0;
      insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, complement_id, fait_le, modification_id)
      values (c.id, 'modification-' || m.id || '-c' || left(y.id::text, 8), part, 'Commande modifiée à la demande du client',
        coalesce(m.moyen_remboursement, case when y.moyen_encaissement = 'carte' then 'terminal' else 'especes' end), 'fait',
        m.personnel_id, m.personnel_nom, y.id, now(), m.id)
      returning * into r2;
      rembs := rembs || jsonb_build_array(to_jsonb(r2));
      rembourse := rembourse + part;
      reste := reste - part;
    end loop;
    if exists (select 1 from jsonb_array_elements(rembs) e where e ->> 'statut' = 'fait') then
      perform maj_rembourse(c.id);
    end if;
  end if;

  update modifications_commande set statut = 'appliquee', stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent), fini_le = now()
    where id = m.id;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    values (c.id, c.statut, c.statut, 'gestion:' || m.personnel_nom, 'modifiee plats, ' ||
      case when m.difference_centimes > 0 then '+' else '' end || (m.difference_centimes / 100.0)::numeric(10, 2)::text || ' CHF');
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (m.personnel_id, m.personnel_nom, 'commande_modifiee', c.id::text, jsonb_build_object('valeur_centimes', m.ancienne_valeur_centimes),
      jsonb_build_object('numero', c.numero, 'valeur_centimes', m.total_centimes, 'reglement', m.reglement,
        'rembourse_voulu_centimes', voulu, 'rembourse_centimes', rembourse,
        'moyen_remboursement', case when rb.id is not null then rb.moyen end,
        'ventilation', ventil,
        'remboursements', (select coalesce(jsonb_agg(jsonb_build_object('moyen', e ->> 'moyen', 'centimes', (e ->> 'montant_centimes')::integer)), '[]'::jsonb)
          from jsonb_array_elements(rembs) e)));
  return jsonb_build_object('applique', true, 'commande_id', c.id, 'numero', c.numero, 'reglement', m.reglement,
    'difference_centimes', m.difference_centimes, 'ajouts', m.ajouts, 'retires', m.retires,
    'remboursement', case when rb.id is not null then to_jsonb(rb) end, 'complement', case when k.id is not null then to_jsonb(k) end,
    -- Tous les remboursements créés (paiement de départ, puis compléments) ; voulu et rendu, l'écart étant une remise
    -- ou une cagnotte qui ne se rend pas en argent.
    'remboursements', rembs, 'rembourse_voulu_centimes', voulu, 'rembourse_centimes', rembourse,
    -- Baisse déduite d'un complément encore dû : ce que le client avait à payer avant et après (rien ne repart).
    'du_avant_centimes', du_avant, 'du_apres_centimes', du_apres);
end;
$$;

revoke execute on function ventilation_frais_ramenes(jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function ventilation_frais_ramenes(jsonb, jsonb, integer) to service_role;
