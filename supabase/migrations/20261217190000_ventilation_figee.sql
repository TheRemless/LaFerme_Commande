-- Ventilation figée (demande du chef du 19.11.2026, coordination bo-pilotage et bo-carte ; plan de conformité
-- comptable, R17 et art. 41 LTVA). Numéro donné par le chef. Après 20261217130000 (bo-pilotage, contrat de
-- ventilation), 20261217150000 (bo-carte, taux par ligne) et 20261217170000 (bo-commandes, historique).
--
-- Avant : une commande payée puis modifiée recalculait sa TVA sur ses nouvelles lignes ; sur une commande mixte, la
-- vente d'origine changeait après coup, et un complément prenait le taux de la commande.
-- Maintenant :
--   1. La ventilation par taux d'une commande est figée au paiement (commandes.ventilation_figee, posée quand
--      statut_paiement passe à 'paye' ou 'encaisse') ; ventilation_commande la renvoie telle quelle. Une commande à
--      encaisser suit ses lignes jusqu'à l'encaissement. Les commandes déjà payées sont figées sur leur ventilation
--      du moment.
--   2. Une modification d'une commande payée porte sa ventilation (modifications_commande.ventilation) : les montants
--      bruts par taux (lignes et frais) après moins avant. Parts signées, somme = différence (0 pour un échange au
--      même prix : la correction sans argent que bo-pilotage exporte en avoir de la ligne retirée et vente de la
--      ligne ajoutée, à fini_le).
--   3. Un complément porte cette ventilation (complements.ventilation, tva_centimes = somme des parts, signée : la
--      contrainte « tva_centimes >= 0 » des compléments tombe). Réduit par une baisse : ramené au prorata.
--   4. Un remboursement d'une modification la désigne (remboursements.modification_id) ; ventilation_remboursement
--      rend l'opposé de la ventilation de la modification, ramené à son montant.
--   4 bis. Chaque remboursement est réparti une fois, à sa création (remboursements.ventilation, déclencheur
--      ventiler_remboursement), sur ce qui reste payé à chaque taux : vente figée + compléments encaissés + corrections
--      sans argent − avoirs précédents (ventilation_en_cours). Celui qui rend tout le reste rend exactement ce reste,
--      TVA comprise : une commande remboursée en entier finit à 0 en argent et en TVA, à chaque taux (défaut 3 de la
--      relecture de client-compte : arrondis cumulés, cagnotte et avoirs successifs). Une baisse se rend d'abord sur
--      les taux des articles retirés, dans la limite de ce qui y reste payé.
--   5. ventilation_complement(k) [{ taux, ttc, tva }] pour les exports de bo-pilotage : complements.ventilation, sinon
--      repli sur le taux de la commande et k.tva_centimes.
-- Plat offert (relecture argent de client-compte sur #271) : « Reprendre cette commande » (lignes_commande_compte,
-- 20261108090000 ; derniere_commande_compte, 20261201110000) ne reprend pas la ligne offerte, qui serait refacturée au
-- prix du jour ; appliquer_geste (20261217170000) accepte aussi une commande prête, comme changer les plats.
-- Objets recréés depuis leur dernière définition : ventilation_commande (20261217150000, bo-carte : désormais
-- coalesce(ventilation_figee, ventilation_lignes(o))), ventilation_remboursement, tva_commande_avant et
-- tva_commande_lignes (20261217150000 ; le taux de la commande suit la ventilation figée, une ligne offerte n'en donne
-- pas ; tva_centimes = TVA de la vente figée, car le total d'une commande payée reste le payé au départ), appliquer_modification (20261217170000).

alter table commandes add column ventilation_figee jsonb;
alter table modifications_commande add column ventilation jsonb;
alter table complements add column ventilation jsonb;
alter table complements drop constraint complements_tva_centimes_check;
alter table remboursements add column modification_id uuid references modifications_commande (id) on delete set null;
alter table remboursements add column ventilation jsonb;

-- Répartit p_montant au prorata de poids signés (somme des poids non nulle), au centime : plus forts restes.
create or replace function repartir_signe(p_montant integer, p_poids integer[]) returns integer[]
language plpgsql immutable as $$
declare
  n integer := coalesce(array_length(p_poids, 1), 0);
  total bigint := 0;
  parts integer[] := '{}';
  restes numeric[] := '{}';
  exact numeric;
  reste integer;
  i integer;
  k integer;
begin
  if n = 0 then
    return '{}';
  end if;
  for i in 1 .. n loop
    total := total + p_poids[i];
  end loop;
  if total = 0 then
    parts := array_fill(0, array[n]);
    parts[n] := p_montant;
    return parts;
  end if;
  reste := p_montant;
  for i in 1 .. n loop
    exact := p_montant::numeric * p_poids[i] / total;
    parts[i] := floor(exact)::integer;
    restes[i] := exact - floor(exact);
    reste := reste - parts[i];
  end loop;
  for k in 1 .. reste loop
    select x.i into i from (select generate_subscripts(restes, 1) as i) x order by restes[x.i] desc, x.i limit 1;
    parts[i] := parts[i] + 1;
    restes[i] := -1;
  end loop;
  return parts;
end;
$$;

-- [{ taux, ttc }] ramenée à p_montant au prorata des ttc (signés), TVA de chaque part recalculée.
create or replace function ventilation_ramenee(p_ventilation jsonb, p_montant integer) returns jsonb
language sql immutable as $$
  with v as (
    select (x ->> 'taux')::numeric as taux, (x ->> 'ttc')::integer as ttc, row_number() over (order by (x ->> 'taux')::numeric) as rang
    from jsonb_array_elements(coalesce(p_ventilation, '[]'::jsonb)) x
  ),
  p as (
    select repartir_signe(p_montant, array_agg(ttc order by rang)) as parts, array_agg(taux order by rang) as taux from v
  )
  select coalesce(jsonb_agg(jsonb_build_object('taux', p.taux[i], 'ttc', p.parts[i],
      'tva', round(p.parts[i] * p.taux[i] / (100 + p.taux[i]))::integer) order by i), '[]'::jsonb)
  from p, generate_subscripts(p.parts, 1) i;
$$;

-- Montants bruts par taux d'une commande telle qu'elle est maintenant (lignes, et p_frais selon frais_tva_mixte),
-- sans rabais ni cagnotte, jamais figée.
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
  return (select coalesce(jsonb_agg(jsonb_build_object('taux', (x ->> 'taux')::numeric, 'ttc', (x ->> 'ttc')::integer)), '[]'::jsonb)
    from jsonb_array_elements(ventilation_lignes(o)) x);
end;
$$;

-- Après moins avant, par taux, parts non nulles seulement, TVA de chaque part (signée).
create or replace function ventilation_difference(p_avant jsonb, p_apres jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('taux', d.taux, 'ttc', d.ttc, 'tva', round(d.ttc * d.taux / (100 + d.taux))::integer)
      order by d.taux), '[]'::jsonb)
  from (
    select t.taux, sum(t.ttc)::integer as ttc
    from (
      select (x ->> 'taux')::numeric as taux, (x ->> 'ttc')::integer as ttc from jsonb_array_elements(coalesce(p_apres, '[]'::jsonb)) x
      union all
      select (x ->> 'taux')::numeric, -(x ->> 'ttc')::integer from jsonb_array_elements(coalesce(p_avant, '[]'::jsonb)) x
    ) t
    group by t.taux
  ) d
  where d.ttc <> 0;
$$;

create or replace function ventilation_commande(o commandes) returns jsonb
language sql stable as $$
  -- Figée au paiement : la vente d'origine ne bouge plus ; sinon les lignes et montants actuels (bo-carte).
  select coalesce(o.ventilation_figee, ventilation_lignes(o));
$$;

-- Figée au paiement : la vente d'origine est celle du moment où l'argent est reçu (ou l'encaissement au comptoir).
create or replace function figer_ventilation() returns trigger
language plpgsql as $$
begin
  if new.statut_paiement in ('paye', 'encaisse') and old.statut_paiement not in ('paye', 'encaisse', 'rembourse')
     and new.ventilation_figee is null and exists (select 1 from commande_lignes where commande_id = new.id) then
    new.ventilation_figee := ventilation_commande(new);
  end if;
  return new;
end;
$$;
create trigger figer_ventilation before update of statut_paiement on commandes
  for each row execute function figer_ventilation();

-- Commandes déjà payées : figées sur leur ventilation du moment. Seule ventilation_figee change : modifie_le garde
-- la vraie dernière modification (relecture de bo-carte), le déclencheur commandes_modifie_le est coupé le temps du
-- rattrapage (aucun autre déclencheur ne suit cette colonne). Renvoie le nombre de commandes figées.
create or replace function rattraper_ventilations_figees() returns integer
language plpgsql as $$
declare
  n integer;
begin
  alter table commandes disable trigger commandes_modifie_le;
  update commandes c set ventilation_figee = ventilation_commande(c)
    where c.statut_paiement in ('paye', 'encaisse', 'rembourse') and c.ventilation_figee is null
      and exists (select 1 from commande_lignes l where l.commande_id = c.id);
  get diagnostics n = row_count;
  alter table commandes enable trigger commandes_modifie_le;
  return n;
end;
$$;
revoke execute on function rattraper_ventilations_figees() from public, anon, authenticated, service_role;
select rattraper_ventilations_figees();

create or replace function ventilation_remboursement(r remboursements) returns jsonb
language plpgsql stable as $$
declare
  o commandes%rowtype;
  taux numeric[];
  poids integer[];
  parts integer[];
  n integer;
  somme integer := 0;
  res jsonb := '[]'::jsonb;
  i integer;
  t numeric;
  mv jsonb;
begin
  -- Répartie une fois pour toutes à sa création (calculer_ventilation_remboursement) : c'est elle qui fait foi.
  if r.ventilation is not null then
    return r.ventilation;
  end if;
  -- Remboursement d'une modification (baisse) : l'opposé de la ventilation de la modification, ramené au montant
  -- (plafond, partage entre paiements). Parts signées : une part négative est une vente (article ajouté).
  if r.modification_id is not null then
    mv := (select ventilation from modifications_commande where id = r.modification_id);
    if mv is not null and jsonb_array_length(mv) > 0 then
      return ventilation_ramenee((select jsonb_agg(jsonb_build_object('taux', (x ->> 'taux')::numeric, 'ttc', -(x ->> 'ttc')::integer)) from jsonb_array_elements(mv) x),
        r.montant_centimes);
    end if;
  end if;
  select * into o from commandes where id = r.commande_id;
  if jsonb_typeof(r.montants_lignes) = 'object' then
    select coalesce(array_agg(x.taux order by x.taux), '{}'), coalesce(array_agg(x.m order by x.taux), '{}') into taux, poids
      from (select l.taux_tva_pourcent as taux, sum((k.value #>> '{}')::integer)::integer as m
            from jsonb_each(r.montants_lignes) k
            join commande_lignes l on l.commande_id = r.commande_id and l.position = k.key::smallint
            group by l.taux_tva_pourcent) x;
  end if;
  n := coalesce(array_length(taux, 1), 0);
  if n > 0 then
    for i in 1 .. n loop
      somme := somme + poids[i];
    end loop;
    parts := case when somme = r.montant_centimes then poids else repartir_centimes(r.montant_centimes, poids) end;
  else
    select coalesce(array_agg((v ->> 'taux')::numeric order by (v ->> 'taux')::numeric), '{}'),
           coalesce(array_agg((v ->> 'ttc')::integer order by (v ->> 'taux')::numeric), '{}')
      into taux, poids from jsonb_array_elements(ventilation_commande(o)) v;
    n := coalesce(array_length(taux, 1), 0);
    if n = 0 then
      return '[]'::jsonb;
    end if;
    parts := case when regle_tva('rabais_tva_mixte') = 'prorata' then repartir_centimes(r.montant_centimes, poids)
                  else imputer_dans_lordre(r.montant_centimes, poids) end;
  end if;
  for i in 1 .. n loop
    t := taux[i];
    if parts[i] <> 0 then
      res := res || jsonb_build_object('taux', t, 'ttc', parts[i], 'tva', round(parts[i] * t / (100 + t))::integer);
    end if;
  end loop;
  return res;
end;
$$;

create or replace function tva_commande_avant() returns trigger
language plpgsql as $$
declare
  v jsonb := ventilation_commande(new);
begin
  if exists (select 1 from commande_lignes where commande_id = new.id) then
    new.tva_centimes := (select coalesce(sum((x ->> 'tva')::integer), 0) from jsonb_array_elements(v) x);
    -- Taux le plus haut des lignes payantes (une ligne à 0 CHF ne donne pas son taux), sinon de toutes.
    -- Vente figée : son taux le plus haut. Sinon (bo-carte) le plus haut des lignes payantes non offertes, sinon de toutes.
    new.taux_tva_pourcent := case when new.ventilation_figee is not null
      then (select max((x ->> 'taux')::numeric) from jsonb_array_elements(new.ventilation_figee) x)
      else coalesce((select max(taux_tva_pourcent) from commande_lignes where commande_id = new.id and total_centimes <> 0 and not offert),
                    (select max(taux_tva_pourcent) from commande_lignes where commande_id = new.id)) end;
  end if;
  return new;
end;
$$;

create or replace function tva_commande_lignes() returns trigger
language plpgsql as $$
declare
  o commandes%rowtype;
  tv integer;
  tx numeric;
begin
  for o in select c.* from commandes c where c.id in (select commande_id from lignes_touchees) loop
    continue when not exists (select 1 from commande_lignes where commande_id = o.id);
    tv := (select coalesce(sum((x ->> 'tva')::integer), 0) from jsonb_array_elements(ventilation_commande(o)) x);
    tx := case when o.ventilation_figee is not null
      then (select max((x ->> 'taux')::numeric) from jsonb_array_elements(o.ventilation_figee) x)
      else coalesce((select max(taux_tva_pourcent) from commande_lignes where commande_id = o.id and total_centimes <> 0 and not offert),
                    (select max(taux_tva_pourcent) from commande_lignes where commande_id = o.id)) end;
    -- Seulement si quelque chose change : une commande juste ne voit pas son modifie_le avancer.
    if (o.tva_centimes, o.taux_tva_pourcent) is distinct from (tv, tx) then
      update commandes set tva_centimes = tv, taux_tva_pourcent = tx where id = o.id;
    end if;
  end loop;
  return null;
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
        w := case when x.ventilation is not null then ventilation_ramenee(x.ventilation, x.montant_centimes - reste) end;
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

-- Contrat avec bo-pilotage : [{ taux, ttc, tva }] d'un complément. Sans ventilation (compléments d'avant), un seul
-- taux, celui de la commande, et la TVA notée sur le complément.
create or replace function ventilation_complement(k complements) returns jsonb
language sql stable as $$
  select case when k.ventilation is not null then
      (select coalesce(jsonb_agg(jsonb_build_object('taux', (x ->> 'taux')::numeric, 'ttc', (x ->> 'ttc')::integer, 'tva', (x ->> 'tva')::integer)
        order by (x ->> 'taux')::numeric), '[]'::jsonb) from jsonb_array_elements(k.ventilation) x)
    else (select jsonb_build_array(jsonb_build_object('taux', o.taux_tva_pourcent, 'ttc', k.montant_centimes, 'tva', k.tva_centimes))
      from commandes o where o.id = k.commande_id) end;
$$;

revoke execute on function repartir_signe(integer, integer[]), ventilation_ramenee(jsonb, integer), ventilation_brute(uuid, integer),
  ventilation_difference(jsonb, jsonb), ventilation_complement(complements), figer_ventilation() from public, anon, authenticated;
grant execute on function repartir_signe(integer, integer[]), ventilation_ramenee(jsonb, integer), ventilation_brute(uuid, integer),
  ventilation_difference(jsonb, jsonb), ventilation_complement(complements) to service_role;

-- Plat offert : jamais repris au prix du jour.
create or replace function lignes_commande_compte(p_compte uuid, p_commande uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', l.plat_slug, 'nom', l.nom, 'qte', l.qte, 'choix', l.choix, 'retraits', l.retraits, 'note', l.note,
    'unitaire_centimes', l.unitaire_centimes
  ) order by l.position), '[]'::jsonb)
  from commandes o join commande_lignes l on l.commande_id = o.id
  where o.id = p_commande and o.compte_id = p_compte and not l.offert
  having count(*) > 0;
$$;

create or replace function derniere_commande_compte(p_compte uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id,
    'cree_le', o.cree_le,
    'mode', o.mode,
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte) order by l.position)
      from commande_lignes l where l.commande_id = o.id and not l.offert
    ), '[]'::jsonb)
  )
  from commandes o
  where o.compte_id = p_compte and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
  order by o.cree_le desc
  limit 1;
$$;

create or replace function appliquer_geste(p_geste uuid, p_commande uuid, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  nom text := equipe_nom(p_personnel);
  g gestes_client%rowtype;
  c commandes%rowtype;
  pl plats%rowtype;
  ligne uuid;
begin
  if not gestes_actifs() then
    raise exception 'gestes_desactives';
  end if;
  select * into c from commandes where id = p_commande for update;
  select * into g from gestes_client where id = p_geste for update;
  if c.id is null or g.id is null or g.offert_le is not null or lower(c.client_email) is distinct from g.email then
    return false;
  end if;
  -- Comme changer les plats : jusqu'à « prête », la commande est encore au restaurant.
  if c.statut not in ('nouvelle', 'acceptee', 'en_preparation', 'prete') then
    raise exception 'statut_non_modifiable';
  end if;
  if g.plat_slug is not null then
    select * into pl from plats where slug = g.plat_slug;
    insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, note, offert)
    values (c.id, coalesce((select max(position) from commande_lignes where commande_id = c.id), 0) + 1, g.plat_slug, g.plat_nom,
      coalesce(pl.station, 'cuisine'), 1, 0, 0, 'Offert', true)
    returning id into ligne;
    -- Un plat offert hors pizza : la commande n'est plus « pizzas seulement » (délai, tickets).
    if coalesce(pl.station::text, 'cuisine') <> 'pizza' then
      update commandes set pizzas_seulement = false where id = c.id and pizzas_seulement;
    end if;
  end if;
  update gestes_client set offert_commande_id = c.id, offert_par = nom, offert_le = now(), offert_ligne_id = ligne,
    offert_valeur_centimes = coalesce(pl.prix_centimes, g.valeur_centimes)
    where id = g.id;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    values (c.id, c.statut, c.statut, 'tablette:' || nom, 'geste offert ' || g.detail);
  return true;
end;
$$;

-- Ce qui reste payé à chaque taux : [{ taux, ttc, tva }], par taux croissant, parts nulles écartées. Vente figée
-- (ventilation_commande), compléments encaissés (pas ceux rendus à l'annulation), modifications appliquées sans argent
-- (échange au même prix), moins les remboursements faits ou en cours.
create or replace function ventilation_en_cours(p_commande uuid) returns jsonb
language sql stable as $$
  with parts as (
    select (x ->> 'taux')::numeric as taux, (x ->> 'ttc')::integer as ttc, (x ->> 'tva')::integer as tva
    from commandes o, jsonb_array_elements(ventilation_commande(o)) x where o.id = p_commande
    union all
    select (x ->> 'taux')::numeric, (x ->> 'ttc')::integer, (x ->> 'tva')::integer
    from complements k, jsonb_array_elements(ventilation_complement(k)) x
    where k.commande_id = p_commande and k.statut = 'encaisse' and k.rembourse_le is null
    union all
    select (x ->> 'taux')::numeric, (x ->> 'ttc')::integer, (x ->> 'tva')::integer
    from modifications_commande m, jsonb_array_elements(m.ventilation) x
    where m.commande_id = p_commande and m.statut = 'appliquee' and m.difference_centimes = 0 and m.ventilation is not null
    union all
    select (x ->> 'taux')::numeric, -(x ->> 'ttc')::integer, -(x ->> 'tva')::integer
    from remboursements r, jsonb_array_elements(ventilation_remboursement(r)) x
    where r.commande_id = p_commande and r.statut in ('fait', 'en_cours')
  )
  select coalesce(jsonb_agg(jsonb_build_object('taux', taux, 'ttc', ttc, 'tva', tva) order by taux), '[]'::jsonb)
  from (select taux, sum(ttc)::integer as ttc, sum(tva)::integer as tva from parts group by taux) t
  where ttc <> 0 or tva <> 0;
$$;

-- Répartition d'un remboursement au moment où il naît, sur ce qui reste payé à chaque taux.
--   Tout le reste rendu : exactement le reste, TVA comprise (aucun arrondi cumulé).
--   Remboursement d'une baisse : d'abord les taux des articles retirés (l'opposé de la ventilation de la modification),
--     chacun plafonné à ce qui y reste payé ; au-delà (frais, partage), le reste comme un remboursement global.
--   Manque rendu par ligne (montants_lignes) : la règle par article de bo-carte.
--   Sinon : sur ce qui reste payé, selon rabais_tva_mixte (réduit d'abord, ou au prorata).
create or replace function calculer_ventilation_remboursement(r remboursements) returns jsonb
language plpgsql stable as $$
declare
  e jsonb := ventilation_en_cours(r.commande_id);
  mv jsonb;
  taux numeric[];
  e_ttc integer[];
  e_tva integer[];
  w integer[];
  reste integer[];
  plus integer[];
  parts integer[];
  n integer;
  total_e integer := 0;
  somme_w integer := 0;
  res jsonb := '[]'::jsonb;
  i integer;
  t numeric;
  v integer;
begin
  if jsonb_typeof(r.montants_lignes) = 'object' then
    r.ventilation := null;
    return ventilation_remboursement(r);
  end if;
  if r.modification_id is not null then
    mv := (select ventilation from modifications_commande where id = r.modification_id);
  end if;
  -- Les taux de ce qui reste payé, et ceux de la modification.
  select coalesce(array_agg(x.taux order by x.taux), '{}') into taux from (
    select (y ->> 'taux')::numeric as taux from jsonb_array_elements(e) y
    union select (y ->> 'taux')::numeric from jsonb_array_elements(coalesce(mv, '[]'::jsonb)) y) x;
  n := coalesce(array_length(taux, 1), 0);
  if n = 0 then
    r.ventilation := null;
    return ventilation_remboursement(r);
  end if;
  e_ttc := array_fill(0, array[n]);
  e_tva := array_fill(0, array[n]);
  w := array_fill(0, array[n]);
  for i in 1 .. n loop
    e_ttc[i] := (select coalesce(sum((y ->> 'ttc')::integer), 0) from jsonb_array_elements(e) y where (y ->> 'taux')::numeric = taux[i]);
    e_tva[i] := (select coalesce(sum((y ->> 'tva')::integer), 0) from jsonb_array_elements(e) y where (y ->> 'taux')::numeric = taux[i]);
    total_e := total_e + e_ttc[i];
    if mv is not null then
      w[i] := (select coalesce(-sum((y ->> 'ttc')::integer), 0) from jsonb_array_elements(mv) y where (y ->> 'taux')::numeric = taux[i]);
    end if;
  end loop;

  if total_e > 0 and r.montant_centimes >= total_e then
    -- Tout le reste : exactement, TVA comprise ; un dépassement (ne devrait pas arriver) au taux le plus haut.
    for i in 1 .. n loop
      v := e_ttc[i] + case when i = n then r.montant_centimes - total_e else 0 end;
      if v <> 0 then
        res := res || jsonb_build_object('taux', taux[i], 'ttc', v,
          'tva', case when v = e_ttc[i] then e_tva[i] else round(v * taux[i] / (100 + taux[i]))::integer end);
      end if;
    end loop;
    return res;
  end if;

  -- Baisse : les taux retirés, plafonnés à ce qui y reste payé.
  for i in 1 .. n loop
    if w[i] > 0 then
      w[i] := least(w[i], greatest(e_ttc[i], 0));
    end if;
    somme_w := somme_w + w[i];
  end loop;
  if mv is not null and somme_w > 0 and r.montant_centimes <= somme_w then
    parts := repartir_signe(r.montant_centimes, w);
  else
    -- Le reste (ou tout, sans modification) sur ce qui reste payé à chaque taux, après la part des taux retirés.
    if mv is null or somme_w <= 0 then
      w := array_fill(0, array[n]);
      somme_w := 0;
    end if;
    reste := array_fill(0, array[n]);
    for i in 1 .. n loop
      reste[i] := greatest(e_ttc[i] - greatest(w[i], 0), 0);
    end loop;
    plus := case when regle_tva('rabais_tva_mixte') = 'prorata' then repartir_centimes(r.montant_centimes - somme_w, reste)
                 else imputer_dans_lordre(r.montant_centimes - somme_w, reste) end;
    parts := w;
    for i in 1 .. n loop
      parts[i] := w[i] + plus[i];
    end loop;
  end if;
  for i in 1 .. n loop
    t := taux[i];
    if parts[i] <> 0 then
      res := res || jsonb_build_object('taux', t, 'ttc', parts[i],
        'tva', case when parts[i] = e_ttc[i] then e_tva[i] else round(parts[i] * t / (100 + t))::integer end);
    end if;
  end loop;
  return res;
end;
$$;

create or replace function ventiler_remboursement() returns trigger
language plpgsql as $$
begin
  new.ventilation := calculer_ventilation_remboursement(new);
  return new;
end;
$$;
create trigger ventiler_remboursement before insert on remboursements
  for each row execute function ventiler_remboursement();

revoke execute on function ventilation_en_cours(uuid), calculer_ventilation_remboursement(remboursements), ventiler_remboursement()
  from public, anon, authenticated;
grant execute on function ventilation_en_cours(uuid), calculer_ventilation_remboursement(remboursements) to service_role;
