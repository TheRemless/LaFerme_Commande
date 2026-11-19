-- TVA par plat et par ligne (compta, bo-carte ; demande de Jérémy du 19.11.2026, coordination bo-pilotage).
-- Référence : docs/compta/tva-et-cagnotte.md (règles R1, R3, R5, R9, R13, R15) et docs/compta/plan-conformite.md.
--
-- 1. Taux dans une table datée (R5) : taux_tva (normal, reduit, valable_du, valable_au). Aucun taux en dur ailleurs.
--    taux_tva_du(categorie, jour) lève taux_tva_manquant plutôt que de rendre 0. Le réglage tva_emporter_pourcent
--    reçoit la valeur du réduit en vigueur ; le site ne le lit plus (il lit la table), seuls deux scripts d'essai.
-- 2. Taux d'un plat (R1, R3) : plats.teneur_alcool (% vol.), posée au back-office sur les boissons. Le taux est
--    calculé, jamais saisi : plus de 0,5 % vol. → normal, sinon réduit. Le site ne vend qu'en livraison et à
--    l'emporter (pas de sur place, R4 sans objet) : le canal ne change donc pas le taux.
-- 3. Taux et TVA par ligne, figés : commande_lignes.taux_tva_pourcent et tva_centimes, remplis par un déclencheur
--    à l'insertion (taux du jour de service de la commande). Personne ne les envoie : le taux n'est jamais saisi.
--    Les lignes d'avant prennent le taux de leur commande (un seul taux jusqu'ici).
-- 4. Frais d'une commande mixte (R9, question F3) : réglage frais_tva_mixte, 'normal' (défaut, tous les frais au
--    taux le plus haut) ou 'prorata' (selon les lignes). 2,6 % sur la totalité n'est jamais possible.
-- 5. Rabais en francs (code, cagnotte) et remboursement global d'une commande mixte (R13, R15, question F4) :
--    réglage rabais_tva_mixte, 'reduit_dabord' (défaut, imputé d'abord au taux le plus bas : la base du taux haut
--    ne baisse qu'en dernier, la TVA n'est jamais sous-déclarée) ou 'prorata'. Somme répartie = montant, au centime.
-- 6. Contrat partagé avec bo-pilotage (plan-conformite.md) : ventilation_commande(o) et
--    ventilation_remboursement(r) recréées (mêmes signatures, même forme JSON) pour ventiler par ligne.
--    commandes.tva_centimes vaut toujours la somme des tva de ventilation_commande (déclencheurs) et
--    commandes.taux_tva_pourcent le taux unique, ou le taux le plus haut si la commande en a deux.
--
-- Pour une commande à un seul taux (toutes jusqu'ici), la TVA est exactement celle d'avant :
-- round(total × taux / (100 + taux)). Aucune boisson alcoolisée n'est activée à la carte : Jérémy décide.

-- ---------- 1. Taux datés ----------

create table taux_tva (
  id smallint generated always as identity primary key,
  categorie text not null check (categorie in ('normal', 'reduit')),
  pourcent numeric(4, 2) not null check (pourcent >= 0 and pourcent < 100),
  valable_du date not null,
  valable_au date check (valable_au is null or valable_au >= valable_du),
  unique (categorie, valable_du)
);
alter table taux_tva enable row level security;
create policy "lecture publique" on taux_tva for select to anon, authenticated using (true);
revoke all on taux_tva from anon, authenticated;
grant select on taux_tva to anon, authenticated;
grant select, insert, update, delete on taux_tva to service_role;

-- Art. 25 LTVA, taux en vigueur depuis le 1er janvier 2024. Un changement (vote du 29.11.2026, 8,5 % début 2028
-- si accepté) se fait en fermant la ligne (valable_au) et en ajoutant la suivante.
insert into taux_tva (categorie, pourcent, valable_du) values ('normal', 8.1, date '2024-01-01'), ('reduit', 2.6, date '2024-01-01');

create function taux_tva_du(p_categorie text, p_jour date) returns numeric
language plpgsql stable as $$
declare
  t numeric;
begin
  select pourcent into t from taux_tva
    where categorie = p_categorie and valable_du <= p_jour and (valable_au is null or valable_au >= p_jour)
    order by valable_du desc limit 1;
  if t is null then
    raise exception 'taux_tva_manquant: % au %', p_categorie, p_jour;
  end if;
  return t;
end;
$$;

-- Plus de 0,5 % vol. : boisson alcoolique, taux normal dans tous les canaux (art. 25 LTVA, MI 07 ch. 2.1).
create function categorie_tva(p_teneur_alcool numeric) returns text
language sql immutable as $$
  select case when coalesce(p_teneur_alcool, 0) > 0.5 then 'normal' else 'reduit' end;
$$;

-- Le site lit ici les taux du jour (catalogue, calcul du panier).
create view taux_tva_en_vigueur with (security_invoker = true) as
  select categorie, pourcent from taux_tva
  where valable_du <= (now() at time zone 'Europe/Zurich')::date
    and (valable_au is null or valable_au >= (now() at time zone 'Europe/Zurich')::date);
grant select on taux_tva_en_vigueur to anon, authenticated;

update reglages set valeur = to_jsonb(taux_tva_du('reduit', (now() at time zone 'Europe/Zurich')::date))
  where cle = 'tva_emporter_pourcent';

insert into reglages (cle, valeur, proposition) values
  ('frais_tva_mixte', '"normal"', false),
  ('rabais_tva_mixte', '"reduit_dabord"', false)
on conflict (cle) do nothing;

create function regle_tva(p_cle text) returns text
language sql stable as $$
  select case
    when p_cle = 'frais_tva_mixte' and v in ('normal', 'prorata') then v
    when p_cle = 'rabais_tva_mixte' and v in ('reduit_dabord', 'prorata') then v
    -- Valeur absente ou illisible : l'option prudente.
    when p_cle = 'frais_tva_mixte' then 'normal'
    else 'reduit_dabord' end
  from (select (select valeur #>> '{}' from reglages where cle = p_cle) as v) x;
$$;

-- ---------- 2. Teneur en alcool d'un plat ----------

alter table plats add column teneur_alcool numeric(4, 1) check (teneur_alcool is null or (teneur_alcool >= 0 and teneur_alcool <= 100));

-- Garde-fou (demande de bo-pilotage, 19.11.2026) : tant que récap, Crésus simple, synthèse et clôture ne lisent pas
-- la ventilation, ils rangeraient une commande mixte entière au taux le plus haut. Une boisson à plus de 0,5 % vol. ne
-- peut donc pas être en vente avant que bo-pilotage passe compta_multi_taux_pret à vrai (faux par défaut).
insert into reglages (cle, valeur, proposition) values ('compta_multi_taux_pret', 'false', false) on conflict (cle) do nothing;

create function alcool_compta_prete() returns boolean
language sql stable as $$
  select coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'compta_multi_taux_pret'), false);
$$;

create function garde_alcool() returns trigger
language plpgsql as $$
begin
  if new.commandable and categorie_tva(new.teneur_alcool) = 'normal' and not alcool_compta_prete() then
    raise exception 'alcool_compta_pas_prete';
  end if;
  return new;
end;
$$;
create trigger garde_alcool before insert or update of commandable, teneur_alcool on plats
  for each row execute function garde_alcool();

-- Même liste que 20261118090000_carte_gestion.sql, + le garde-fou : le gérant voit dans la fiche pourquoi la
-- boisson ne se met pas en vente.
create or replace function motifs_plat(p_id uuid) returns text[]
language sql stable as $$
  select coalesce(array_agg(x.motif order by x.rang, x.motif), '{}')
  from (
    select 1 as rang, 'prix à valider' as motif from plats p where p.id = p_id and p.prix_a_valider
    union all
    select 2, 'allergènes manquants' from plats p where p.id = p_id and coalesce(p.allergenes, '') = ''
    union all
    select 3, 'provenance à fournir' from plats p where p.id = p_id and cardinality(p.provenances_a_fournir) > 0
    union all
    select distinct 4, 'supplément à valider : ' || o.nom
    from plat_groupes g join options o on o.groupe_id = g.groupe_id and o.actif and o.prix_a_valider
    where g.plat_id = p_id
    union all
    select 5, 'retraits à valider' where exists (select 1 from plat_retraits r where r.plat_id = p_id and r.a_valider)
    union all
    select 6, 'boisson alcoolisée : la compta à deux taux n''est pas prête'
    from plats p where p.id = p_id and categorie_tva(p.teneur_alcool) = 'normal' and not alcool_compta_prete()
  ) x;
$$;

-- Taux de chaque plat aujourd'hui, pour le calcul du panier. Même règle que le déclencheur des lignes.
create view tva_plats_publics with (security_invoker = true) as
  select p.slug, p.teneur_alcool,
    (select t.pourcent from taux_tva t
      where t.categorie = categorie_tva(p.teneur_alcool) and t.valable_du <= (now() at time zone 'Europe/Zurich')::date
        and (t.valable_au is null or t.valable_au >= (now() at time zone 'Europe/Zurich')::date)
      order by t.valable_du desc limit 1) as taux_tva_pourcent
  from plats p;
grant select on tva_plats_publics to anon, authenticated;

-- Gérant seulement, journalisé. Seule la teneur se saisit, jamais le taux.
create function regler_teneur_alcool(p_slug text, p_teneur numeric, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  avant numeric;
  jour date := (now() at time zone 'Europe/Zurich')::date;
begin
  perform gerant_nom(p_personnel);
  select teneur_alcool into avant from plats where slug = p_slug for update;
  if not found then
    return null;
  end if;
  if p_teneur is not null and (p_teneur < 0 or p_teneur > 100) then
    raise exception 'teneur_invalide';
  end if;
  -- Une denrée qui contient de l'alcool reste au taux réduit : seule une boisson porte une teneur.
  if p_teneur is not null and not exists (select 1 from plats p join categories c on c.id = p.categorie_id
                                          where p.slug = p_slug and c.slug = 'boissons') then
    raise exception 'pas_une_boisson';
  end if;
  update plats set teneur_alcool = round(p_teneur, 1), modifie_le = now() where slug = p_slug;
  perform journaliser(p_personnel, 'teneur_alcool', p_slug,
    jsonb_build_object('teneur_alcool', avant, 'taux_tva_pourcent', taux_tva_du(categorie_tva(avant), jour)),
    jsonb_build_object('teneur_alcool', round(p_teneur, 1), 'taux_tva_pourcent', taux_tva_du(categorie_tva(p_teneur), jour)));
  return jsonb_build_object('teneur_alcool', round(p_teneur, 1), 'taux_tva_pourcent', taux_tva_du(categorie_tva(p_teneur), jour));
end;
$$;

-- ---------- 3. Taux et TVA par ligne ----------

alter table commande_lignes add column taux_tva_pourcent numeric(4, 2), add column tva_centimes integer;

update commande_lignes l
  set taux_tva_pourcent = c.taux_tva_pourcent,
      tva_centimes = round(l.total_centimes * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer
  from commandes c
  where c.id = l.commande_id and l.taux_tva_pourcent is null;

-- Jour de service de la commande : le taux en vigueur ce jour-là (une commande prévue après un changement de taux
-- prend le nouveau).
create function jour_tva(o commandes) returns date
language sql stable as $$
  select coalesce(case when o.quand_type = 'creneau' then o.quand_date end, (coalesce(o.cree_le, now()) at time zone 'Europe/Zurich')::date);
$$;

create function taux_ligne() returns trigger
language plpgsql as $$
declare
  o commandes%rowtype;
begin
  -- Figé : une ligne modifiée sans changer de plat garde son taux (seule sa TVA suit le montant).
  if tg_op = 'UPDATE' and new.plat_slug is not distinct from old.plat_slug then
    new.taux_tva_pourcent := old.taux_tva_pourcent;
    new.tva_centimes := round(new.total_centimes * new.taux_tva_pourcent / (100 + new.taux_tva_pourcent))::integer;
    return new;
  end if;
  select * into o from commandes where id = new.commande_id;
  new.taux_tva_pourcent := taux_tva_du(categorie_tva((select teneur_alcool from plats where slug = new.plat_slug)), jour_tva(o));
  new.tva_centimes := round(new.total_centimes * new.taux_tva_pourcent / (100 + new.taux_tva_pourcent))::integer;
  return new;
end;
$$;
create trigger taux_ligne before insert or update of plat_slug, total_centimes on commande_lignes
  for each row execute function taux_ligne();

alter table commande_lignes alter column taux_tva_pourcent set not null, alter column tva_centimes set not null;

-- ---------- 4 à 6. Ventilation par taux ----------

-- Répartit p_montant selon des poids, au centime (plus forts restes). Sans poids, tout va au dernier.
create function repartir_centimes(p_montant integer, p_poids integer[]) returns integer[]
language plpgsql immutable as $$
declare
  n integer := coalesce(array_length(p_poids, 1), 0);
  total bigint := 0;
  parts integer[] := '{}';
  restes numeric[] := '{}';
  reste integer;
  i integer;
  j integer;
begin
  if n = 0 then
    return '{}';
  end if;
  for i in 1 .. n loop
    total := total + greatest(p_poids[i], 0);
  end loop;
  if total = 0 then
    for i in 1 .. n loop
      parts := parts || case when i = n then p_montant else 0 end;
    end loop;
    return parts;
  end if;
  for i in 1 .. n loop
    parts := parts || floor(p_montant::numeric * greatest(p_poids[i], 0) / total)::integer;
    restes := restes || (p_montant::numeric * greatest(p_poids[i], 0) / total - floor(p_montant::numeric * greatest(p_poids[i], 0) / total));
  end loop;
  reste := p_montant;
  for i in 1 .. n loop
    reste := reste - parts[i];
  end loop;
  -- Les centimes restants vont aux plus grands restes (à égalité, au taux le plus haut).
  while reste > 0 loop
    j := n;
    for i in reverse n .. 1 loop
      if restes[i] > restes[j] then
        j := i;
      end if;
    end loop;
    parts[j] := parts[j] + 1;
    restes[j] := -1;
    reste := reste - 1;
  end loop;
  return parts;
end;
$$;

-- Impute p_montant dans l'ordre (taux croissants), chaque part plafonnée ; le surplus va au dernier.
create function imputer_dans_lordre(p_montant integer, p_plafonds integer[]) returns integer[]
language plpgsql immutable as $$
declare
  n integer := coalesce(array_length(p_plafonds, 1), 0);
  parts integer[] := '{}';
  reste integer := p_montant;
  i integer;
  x integer;
begin
  for i in 1 .. n loop
    x := least(reste, greatest(p_plafonds[i], 0));
    parts := parts || x;
    reste := reste - x;
  end loop;
  if n > 0 and reste <> 0 then
    parts[n] := parts[n] + reste;
  end if;
  return parts;
end;
$$;

-- [{ taux, ttc, tva, frais_ttc, frais_tva, rabais_ttc, rabais_tva, cagnotte_ttc, cagnotte_tva }] par taux croissant. ttc : payé net à ce
-- taux (lignes + frais − rabais − cagnotte). Somme des ttc = total_centimes, somme des tva = tva_centimes.
-- ventilation_lignes suit toujours les lignes et montants actuels. ventilation_commande est la ventilation de la
-- commande (compta, TVA de la commande par les déclencheurs) : aujourd'hui la même chose ; bo-commandes la recrée pour
-- rendre la ventilation figée au paiement quand elle existe (coalesce(o.ventilation_figee, ventilation_lignes(o))).
-- Une commande payée garde son total payé même modifiée (#249) : sa TVA reste celle de la vente, les différences
-- passent par les compléments et les avoirs.
create function ventilation_lignes(o commandes) returns jsonb
language plpgsql stable as $$
declare
  taux numeric[];
  lignes integer[];
  n integer;
  frais integer[];
  rem_frais integer[];
  rem_plats integer[];
  cag integer[];
  ttc integer[];
  restant integer[];
  remise_plats_m integer;
  remise_frais_m integer;
  ecart integer;
  r jsonb := '[]'::jsonb;
  i integer;
  t numeric;
begin
  select coalesce(array_agg(x.taux order by x.taux), '{}'), coalesce(array_agg(x.ttc order by x.taux), '{}')
    into taux, lignes
    from (select l.taux_tva_pourcent as taux, sum(l.total_centimes)::integer as ttc
          from commande_lignes l where l.commande_id = o.id group by l.taux_tva_pourcent
          -- Une ligne à 0 CHF (plat offert) ne fait pas une commande mixte : elle ne choisit ni le taux des frais ni la
          -- répartition (relecture de client-compte sur #275).
          having sum(l.total_centimes) <> 0) x;
  n := coalesce(array_length(taux, 1), 0);
  if n = 0 then
    -- Sans lignes (commande en cours d'écriture) : le taux de la commande, tout en un.
    t := o.taux_tva_pourcent;
    return jsonb_build_array(jsonb_build_object('taux', t, 'ttc', o.total_centimes,
      'tva', round(o.total_centimes * t / (100 + t))::integer, 'frais_ttc', o.frais_centimes,
      'frais_tva', round(o.frais_centimes * t / (100 + t))::integer, 'rabais_ttc', o.remise_centimes,
      'rabais_tva', round(o.remise_centimes * t / (100 + t))::integer, 'cagnotte_ttc', o.cagnotte_centimes,
      'cagnotte_tva', round(o.cagnotte_centimes * t / (100 + t))::integer));
  end if;

  -- Frais (R8, R9) : au taux des lignes s'il n'y en a qu'un ; commande mixte selon frais_tva_mixte.
  if n = 1 then
    frais := array[o.frais_centimes];
  elsif regle_tva('frais_tva_mixte') = 'prorata' then
    frais := repartir_centimes(o.frais_centimes, lignes);
  else
    frais := imputer_dans_lordre(0, lignes);
    frais[n] := o.frais_centimes;
  end if;

  -- Remise du code : sur les plats (remise_plats, cagnotte.sql), le reste (code « livraison ») sur les frais.
  remise_plats_m := remise_plats(o);
  remise_frais_m := greatest(o.remise_centimes - remise_plats_m, 0);
  rem_frais := repartir_centimes(remise_frais_m, frais);
  if regle_tva('rabais_tva_mixte') = 'prorata' then
    rem_plats := repartir_centimes(remise_plats_m, lignes);
  else
    rem_plats := imputer_dans_lordre(remise_plats_m, lignes);
  end if;
  restant := lignes;
  for i in 1 .. n loop
    restant[i] := lignes[i] - rem_plats[i];
  end loop;
  if regle_tva('rabais_tva_mixte') = 'prorata' then
    cag := repartir_centimes(o.cagnotte_centimes, restant);
  else
    cag := imputer_dans_lordre(o.cagnotte_centimes, restant);
  end if;

  ttc := lignes;
  for i in 1 .. n loop
    ttc[i] := lignes[i] - rem_plats[i] - cag[i] + frais[i] - rem_frais[i];
  end loop;
  -- Le total de la commande fait foi : un écart (montant arrondi ailleurs) va au taux le plus haut.
  ecart := o.total_centimes;
  for i in 1 .. n loop
    ecart := ecart - ttc[i];
  end loop;
  ttc[n] := ttc[n] + ecart;

  for i in 1 .. n loop
    t := taux[i];
    if ttc[i] <> 0 or frais[i] <> 0 or lignes[i] <> 0 then
      r := r || jsonb_build_object('taux', t, 'ttc', ttc[i], 'tva', round(ttc[i] * t / (100 + t))::integer,
        'frais_ttc', frais[i], 'frais_tva', round(frais[i] * t / (100 + t))::integer,
        'rabais_ttc', rem_plats[i] + rem_frais[i], 'rabais_tva', round((rem_plats[i] + rem_frais[i]) * t / (100 + t))::integer,
        'cagnotte_ttc', cag[i], 'cagnotte_tva', round(cag[i] * t / (100 + t))::integer);
    end if;
  end loop;
  if r = '[]'::jsonb then
    t := taux[n];
    r := jsonb_build_array(jsonb_build_object('taux', t, 'ttc', 0, 'tva', 0, 'frais_ttc', 0, 'frais_tva', 0, 'rabais_ttc', 0, 'rabais_tva', 0, 'cagnotte_ttc', 0, 'cagnotte_tva', 0));
  end if;
  return r;
end;
$$;

create or replace function ventilation_commande(o commandes) returns jsonb
language sql stable as $$
  select ventilation_lignes(o);
$$;

-- [{ taux, ttc, tva }] par taux croissant, somme des ttc = montant_centimes. Un manque rend par ligne
-- (montants_lignes) : chaque ligne à son taux. Un remboursement global : selon rabais_tva_mixte, sur ce que la
-- commande a payé à chaque taux.
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
begin
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

-- TVA de la commande = somme de sa ventilation ; taux de la commande = taux unique, sinon le plus haut (pour les
-- lecteurs d'avant). Recalculés quand un montant ou une ligne change, quoi que l'appelant ait écrit.
create function tva_commande_avant() returns trigger
language plpgsql as $$
declare
  v jsonb := ventilation_commande(new);
begin
  if exists (select 1 from commande_lignes where commande_id = new.id) then
    new.tva_centimes := (select coalesce(sum((x ->> 'tva')::integer), 0) from jsonb_array_elements(v) x);
    -- Taux le plus haut des lignes payantes (une ligne à 0 CHF ne donne pas son taux), sinon de toutes.
    new.taux_tva_pourcent := coalesce((select max(taux_tva_pourcent) from commande_lignes where commande_id = new.id and total_centimes <> 0),
                                      (select max(taux_tva_pourcent) from commande_lignes where commande_id = new.id));
  end if;
  return new;
end;
$$;
create trigger tva_commande_avant before update of total_centimes, frais_centimes, sous_total_centimes, remise_centimes,
  cagnotte_centimes, tva_centimes, taux_tva_pourcent, code_promo on commandes
  for each row execute function tva_commande_avant();

-- Une fois par instruction (pas par ligne) : une commande de 20 lignes ne recalcule qu'une fois.
create function tva_commande_lignes() returns trigger
language plpgsql as $$
declare
  o commandes%rowtype;
  tv integer;
  tx numeric;
begin
  for o in select c.* from commandes c where c.id in (select commande_id from lignes_touchees) loop
    continue when not exists (select 1 from commande_lignes where commande_id = o.id);
    tv := (select coalesce(sum((x ->> 'tva')::integer), 0) from jsonb_array_elements(ventilation_commande(o)) x);
    tx := coalesce((select max(taux_tva_pourcent) from commande_lignes where commande_id = o.id and total_centimes <> 0),
                   (select max(taux_tva_pourcent) from commande_lignes where commande_id = o.id));
    -- Seulement si quelque chose change : une commande juste ne voit pas son modifie_le avancer.
    if (o.tva_centimes, o.taux_tva_pourcent) is distinct from (tv, tx) then
      update commandes set tva_centimes = tv, taux_tva_pourcent = tx where id = o.id;
    end if;
  end loop;
  return null;
end;
$$;
create trigger tva_commande_lignes_insert after insert on commande_lignes
  referencing new table as lignes_touchees for each statement execute function tva_commande_lignes();
create trigger tva_commande_lignes_update after update on commande_lignes
  referencing new table as lignes_touchees for each statement execute function tva_commande_lignes();
create trigger tva_commande_lignes_delete after delete on commande_lignes
  referencing old table as lignes_touchees for each statement execute function tva_commande_lignes();

-- ---------- Back-office : la fiche lit la teneur et le taux ----------

-- Même définition que 20261210150000_etiquettes.sql, + teneur_alcool et taux_tva_pourcent de chaque plat.
create or replace function gestion_carte() returns jsonb
language sql stable as $$
  with fiches as (
    select p.*, jsonb_build_object(
      'slug', p.slug, 'nom', p.nom, 'description', p.description, 'prix_centimes', p.prix_centimes,
      'prix_a_valider', p.prix_a_valider, 'commandable', p.commandable, 'station', p.station, 'photo', p.photo,
      'provenance', p.provenance, 'provenances_a_fournir', to_jsonb(p.provenances_a_fournir), 'allergenes', p.allergenes,
      'origine', p.origine, 'archive', p.archive_le is not null, 'jour', p.jour, 'jour_service', p.jour_service,
      'retraits', coalesce((select jsonb_agg(jsonb_build_object('nom', r.nom, 'a_valider', r.a_valider) order by r.ordre) from plat_retraits r where r.plat_id = p.id), '[]'::jsonb),
      'groupes', coalesce((select jsonb_agg(g.slug order by pg.ordre) from plat_groupes pg join groupes_options g on g.id = pg.groupe_id where pg.plat_id = p.id), '[]'::jsonb),
      -- Ce qui bloquerait la mise en ligne si le plat était en vente, et ce qui la bloque déjà
      -- (même règle que la vue plats_bloquants, sans la relire pour chaque plat).
      'manques', to_jsonb(m.manques),
      'bloquants', case when p.commandable and (p.jour is null or p.jour >= (now() at time zone 'Europe/Zurich')::date)
        then to_jsonb(m.manques) else '[]'::jsonb end,
      'dispo', jsonb_build_object('service', p.dispo_service, 'mode', p.dispo_mode, 'jours', to_jsonb(p.dispo_jours)),
      'rupture_jusqu_au', case when p.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then p.rupture_jour end,
      'etiquettes', to_jsonb(p.etiquettes),
      -- Teneur en alcool (boissons) et taux du jour qui en découle (20261217150000).
      'teneur_alcool', p.teneur_alcool,
      'taux_tva_pourcent', taux_tva_du(categorie_tva(p.teneur_alcool), (now() at time zone 'Europe/Zurich')::date)
    ) as fiche
    from plats p
    cross join lateral (select motifs_plat(p.id) as manques) m
  )
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'nom', c.nom,
        'plats', coalesce((select jsonb_agg(f.fiche order by f.ordre, f.nom) from fiches f where f.categorie_id = c.id), '[]'::jsonb)
      ) order by c.ordre)
      from categories c where c.slug <> 'plat-du-jour'
    ), '[]'::jsonb),
    -- Plats du jour d'aujourd'hui et à venir, puis ceux des sept derniers jours.
    'plats_du_jour', coalesce((
      select jsonb_agg(f.fiche order by f.jour desc, f.jour_service, f.nom)
      from fiches f
      where f.origine = 'jour' and f.jour >= (now() at time zone 'Europe/Zurich')::date - 7
    ), '[]'::jsonb),
    'aujourdhui', (now() at time zone 'Europe/Zurich')::date,
    'groupes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', g.slug, 'nom', g.nom, 'choix_min', g.choix_min, 'choix_max', g.choix_max,
        'plats', coalesce((select jsonb_agg(p.slug order by p.nom) from plat_groupes pg join plats p on p.id = pg.plat_id where pg.groupe_id = g.id and p.archive_le is null), '[]'::jsonb),
        'options', coalesce((select jsonb_agg(jsonb_build_object('nom', o.nom, 'prix_centimes', o.prix_centimes, 'prix_a_valider', o.prix_a_valider, 'actif', o.actif,
          'rupture_jusqu_au', case when o.rupture_jour >= (now() at time zone 'Europe/Zurich')::date then o.rupture_jour end,
          'par_defaut', o.par_defaut) order by o.ordre) from options o where o.groupe_id = g.id), '[]'::jsonb)
      ) order by g.id)
      from groupes_options g
    ), '[]'::jsonb),
    'bloquants', (select count(distinct slug) from plats_bloquants),
    'ruptures_groupees', ruptures_groupees_actives()
  );
$$;

revoke execute on function taux_tva_du(text, date), regle_tva(text), regler_teneur_alcool(text, numeric, uuid),
  repartir_centimes(integer, integer[]), imputer_dans_lordre(integer, integer[]), ventilation_lignes(commandes),
  ventilation_commande(commandes), ventilation_remboursement(remboursements), jour_tva(commandes),
  taux_ligne(), tva_commande_avant(), tva_commande_lignes(), garde_alcool()
  from public, anon, authenticated;
grant execute on function taux_tva_du(text, date), regle_tva(text), regler_teneur_alcool(text, numeric, uuid),
  repartir_centimes(integer, integer[]), imputer_dans_lordre(integer, integer[]), ventilation_lignes(commandes),
  ventilation_commande(commandes), ventilation_remboursement(remboursements), jour_tva(commandes)
  to service_role;
