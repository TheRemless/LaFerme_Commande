-- Vague 3, client-compte : parrainage sûr (relecture #260 de qualite, consignes du chef du 15.11.2026). Le parrainage
-- reste éteint ; ces correctifs passent avant tout allumage.
-- 1. Minimum de la commande qui qualifie : CHF 30 de plats nets (base_cagnotte), proposé à Jérémy, réglable au
--    back-office. En dessous, le parrainage attend la commande suivante.
-- 2. Parrain qualifié : son lien ne vaut que s'il a lui-même une commande remise, payée et au minimum.
-- 3. Interrupteur à part, parrainage_actif (éteint) : la cagnotte s'allume sans le parrainage.
-- 4. Une reprise de parrainage manquée faute de solde passe par le rattrapage des gains (rattraper_retraits).
-- 5. L'ajustement du gérant renvoie et journalise le solde réel (relecture FIDÉLITÉ BIS).
-- Empreinte du moyen de paiement (option 3 de qualite) : Stripe n'en documente pas pour TWINT, laissée pour plus tard.
--
-- Objets recréés, tous de client-compte (20261216090000_cagnotte.sql, 20261216100000_parrainage.sql) :
-- lier_parrainage, crediter_parrainage, parrainage_compte, rattraper_retraits, ajuster_cagnotte, reglages_fidelite,
-- regler_fidelite. Ajouts : trois réglages, une ligne dans interrupteurs_gestion.

insert into reglages (cle, valeur, proposition) values
  ('parrainage_actif', 'false', false),
  ('parrainage_minimum_centimes', '3000', true)
  on conflict (cle) do nothing;

insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('parrainage_actif', 'Parrainage',
    'Un montant au parrain et au filleul après la première commande du filleul au minimum de plats, livrée ou retirée et payée. Seulement avec la cagnotte allumée. Montant, plafond et minimum : rubrique Cagnotte plus bas.', 'aucun', 81)
  on conflict (cle) do nothing;

create function parrainage_actif() returns boolean
language sql stable as $$
  select fidelite_active() and coalesce((select valeur = 'true'::jsonb from reglages where cle = 'parrainage_actif'), false);
$$;

create function parrainage_minimum() returns integer
language sql stable as $$
  select greatest(fidelite_entier('parrainage_minimum_centimes', 3000), 0);
$$;

-- Parrain qualifié : une commande remise, payée ou encaissée, sans être close « client absent », au minimum de plats
-- nets.
create function parrain_qualifie(p_compte uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from commandes o
    where o.compte_id = p_compte and o.statut = 'terminee' and o.statut_paiement in ('paye', 'encaisse')
      and o.motif is distinct from 'Client absent à la livraison.' and base_cagnotte(o) >= parrainage_minimum()
  );
$$;

create or replace function lier_parrainage(p_email text, p_code text) returns text
language plpgsql as $$
declare
  f comptes%rowtype;
  parrain uuid;
  debut_mois timestamptz := date_trunc('month', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
begin
  if not parrainage_actif() then
    return 'desactive';
  end if;
  select id into parrain from comptes where code_parrainage = upper(btrim(coalesce(p_code, '')));
  if parrain is null then
    return 'code';
  end if;
  select * into f from comptes where email = lower(btrim(coalesce(p_email, ''))) for update;
  if not found then
    return 'code';
  end if;
  if f.id = parrain then
    return 'soi_meme';
  end if;
  -- Parrain qualifié (relecture #260) : au moins une commande remise, payée et au minimum. Un faux compte qui n'a
  -- commandé qu'une eau à CHF 3 ne recrute personne : la chaîne de faux filleuls est cassée.
  if not parrain_qualifie(parrain) then
    return 'parrain_non_qualifie';
  end if;
  if exists (select 1 from parrainages where filleul_id = f.id) then
    return 'deja';
  end if;
  -- Client nouveau : compte de moins de 24 heures, aucune commande avec ce compte ni avec cet e-mail (Gmail sans
  -- points, sans « +étiquette »), aucun autre compte sur la même boîte.
  if f.cree_le < now() - interval '24 hours'
     or exists (select 1 from commandes where compte_id = f.id)
     or exists (select 1 from commandes where email_cle(client_email) = email_cle(f.email))
     or exists (select 1 from comptes k where k.id <> f.id and email_cle(k.email) = email_cle(f.email)) then
    return 'ancien';
  end if;
  perform 1 from comptes where id = parrain for update;
  if (select count(*) from parrainages where parrain_id = parrain and cree_le >= debut_mois)
     >= greatest(fidelite_entier('parrainage_plafond_mois', 10), 0) then
    return 'plafond';
  end if;
  insert into parrainages (parrain_id, filleul_id) values (parrain, f.id);
  return 'ok';
end;
$$;

create or replace function crediter_parrainage(p_commande uuid) returns text
language plpgsql as $$
declare
  o commandes%rowtype;
  p parrainages%rowtype;
  tels text[];
  adr text;
  montant integer := greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0);
  v_raison text;
begin
  select * into o from commandes where id = p_commande;
  if not found or o.statut <> 'terminee' or o.compte_id is null
     or o.motif is not distinct from 'Client absent à la livraison.' or not parrainage_actif() then
    return null;
  end if;
  select * into p from parrainages where filleul_id = o.compte_id and statut = 'en_attente' for update;
  if not found then
    return null;
  end if;
  -- Téléphones de la commande : le client et la personne qui reçoit (revue de sécurité).
  tels := array_remove(array[tel_cle(o.client_telephone), tel_cle(o.destinataire ->> 'telephone')], '');
  adr := case when o.mode = 'livraison' then adresse_cle(o.adresse) end;
  -- Pas encore encaissée (comptoir) : on attend l'encaissement, qui rappelle cette fonction. Remboursée : refus.
  if o.statut_paiement in ('a_encaisser_retrait', 'en_attente') then
    return null;
  end if;
  if o.statut_paiement not in ('paye', 'encaisse')
     or exists (select 1 from remboursements r where r.commande_id = o.id and r.statut in ('en_cours', 'fait')) then
    v_raison := 'paiement';
  elsif cardinality(tels) > 0 and (
       exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id
               and x.statut not in ('paiement_en_attente', 'annulee')
               and (tel_cle(x.client_telephone) = any(tels) or tel_cle(x.destinataire ->> 'telephone') = any(tels)))
       or exists (select 1 from comptes k where k.id = p.parrain_id and tel_cle(k.telephone) = any(tels))) then
    v_raison := 'telephone';
  elsif adr is not null and exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id and x.mode = 'livraison'
               and adresse_cle(x.adresse) = adr and x.statut not in ('paiement_en_attente', 'annulee')) then
    v_raison := 'adresse';
  end if;
  -- Sous le minimum de plats nets (relecture #260) : rien, le parrainage attend la commande suivante. Le rattachement
  -- n'est possible qu'avant toute commande (lier_parrainage), une commande suivante ne contourne donc rien.
  if v_raison is null and base_cagnotte(o) < parrainage_minimum() then
    return null;
  end if;
  if v_raison is not null then
    update parrainages set statut = 'refuse', raison = v_raison, commande_id = o.id, termine_le = now() where id = p.id;
    return v_raison;
  end if;
  update parrainages set statut = 'credite', commande_id = o.id, termine_le = now() where id = p.id;
  if montant > 0 then
    insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
      values (p.parrain_id, o.id, 'parrainage', montant, 'Parrainage d''un proche'),
             (o.compte_id, o.id, 'parrainage', montant, 'Bienvenue par parrainage');
  end if;
  return 'credite';
end;
$$;

create or replace function parrainage_compte(p_compte uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
    'actif', parrainage_actif(),
    'code', case when parrainage_actif() then code_parrainage(p_compte) end,
    'qualifie', parrain_qualifie(p_compte),
    'minimum_centimes', parrainage_minimum(),
    'montant_centimes', greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0),
    'credites', (select count(*) from parrainages where parrain_id = p_compte and statut = 'credite'),
    'en_attente', (select count(*) from parrainages where parrain_id = p_compte and statut = 'en_attente'),
    'parraine', (select statut from parrainages where filleul_id = p_compte)
  );
$$;

create or replace function rattraper_retraits(p_compte uuid) returns integer
language plpgsql as $$
declare
  c record;
  n integer := 0;
begin
  for c in
    select distinct m.commande_id from cagnotte_mouvements m
    where m.compte_id = p_compte and m.type = 'gain'
      and exists (select 1 from remboursements r where r.commande_id = m.commande_id and r.statut = 'fait')
  loop
    if ajuster_gain(c.commande_id) < 0 then
      n := n + 1;
    end if;
  end loop;
  -- Parrainage repris au remboursement total (relecture #260) : ce qui n'a pas pu l'être faute de solde.
  for c in
    select m.commande_id from cagnotte_mouvements m
    where m.compte_id = p_compte and m.type = 'parrainage'
      and exists (select 1 from parrainages p where p.commande_id = m.commande_id and p.statut = 'refuse' and p.raison = 'rembourse')
    group by m.commande_id having sum(m.montant_centimes) > 0
  loop
    if reprendre_parrainage(c.commande_id) > 0 then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function ajuster_cagnotte(p_email text, p_montant integer, p_motif text, p_personnel uuid) returns integer
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  k comptes%rowtype;
  m text := btrim(coalesce(p_motif, ''));
  avant integer;
begin
  if p_montant is null or p_montant = 0 or abs(p_montant) > 10000 then
    raise exception 'ajustement_refuse:montant';
  end if;
  if length(m) not between 3 and 200 then
    raise exception 'ajustement_refuse:motif';
  end if;
  select * into k from comptes where email = lower(btrim(coalesce(p_email, ''))) for update;
  if not found then
    raise exception 'ajustement_refuse:compte';
  end if;
  avant := solde_cagnotte(k.id);
  if avant + p_montant < 0 then
    raise exception 'ajustement_refuse:negatif';
  end if;
  insert into cagnotte_mouvements (compte_id, type, montant_centimes, motif, par)
    values (k.id, 'ajustement', p_montant, m, auteur);
  -- La clé du journal est l'identifiant du compte, pas son e-mail.
  -- Le solde réel après l'ajustement (relecture FIDÉLITÉ BIS) : une retenue en attente a pu jouer dans la même
  -- instruction (rattraper_retraits).
  perform journaliser(p_personnel, 'cagnotte', k.id::text, jsonb_build_object('solde_centimes', avant),
    jsonb_build_object('solde_centimes', solde_cagnotte(k.id), 'montant_centimes', p_montant, 'motif', m));
  return solde_cagnotte(k.id);
end;
$$;

create or replace function reglages_fidelite() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'active', fidelite_active(),
    'taux_pourcent', fidelite_taux(),
    'seuil_centimes', fidelite_seuil(),
    'soirs_doubles', coalesce((select valeur from reglages where cle = 'fidelite_soirs_doubles'), '{"jours": [], "dates": []}'::jsonb),
    'du_centimes', (select coalesce(sum(montant_centimes), 0)::integer from cagnotte_mouvements),
    'calcule_le', now(),
    'parrainage_montant_centimes', greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0),
    'parrainage_plafond_mois', greatest(fidelite_entier('parrainage_plafond_mois', 10), 0),
    'parrainage_actif', parrainage_actif(),
    'parrainage_minimum_centimes', parrainage_minimum(),
    'comptes', (select count(*) from (select compte_id from cagnotte_mouvements group by compte_id
                                      having sum(montant_centimes) > 0) x)
  );
$$;

create or replace function regler_fidelite(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant jsonb := reglages_fidelite() - 'du_centimes' - 'comptes' - 'active' - 'calcule_le' - 'parrainage_actif';
  t integer := (p ->> 'taux_pourcent')::integer;
  s integer := (p ->> 'seuil_centimes')::integer;
  jours jsonb := coalesce(p #> '{soirs_doubles,jours}', '[]'::jsonb);
  dates jsonb := coalesce(p #> '{soirs_doubles,dates}', '[]'::jsonb);
  pm integer := coalesce((p ->> 'parrainage_montant_centimes')::integer, fidelite_entier('parrainage_montant_centimes', 1000));
  pp integer := coalesce((p ->> 'parrainage_plafond_mois')::integer, fidelite_entier('parrainage_plafond_mois', 10));
  pmin integer := coalesce((p ->> 'parrainage_minimum_centimes')::integer, parrainage_minimum());
begin
  if t is null or t not between 3 and 10 then
    raise exception 'fidelite_refusee:taux';
  end if;
  if s is null or s not between 0 and 5000 then
    raise exception 'fidelite_refusee:seuil';
  end if;
  if jsonb_typeof(jours) <> 'array' or jsonb_typeof(dates) <> 'array' or jsonb_array_length(dates) > 60
     or exists (select 1 from jsonb_array_elements(jours) j where jsonb_typeof(j) <> 'number' or (j #>> '{}')::integer not between 1 and 7)
     or exists (select 1 from jsonb_array_elements_text(dates) d where d !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'fidelite_refusee:soirs';
  end if;
  if pm is null or pm not between 0 and 5000 or pp is null or pp not between 0 and 100 or pmin is null or pmin not between 0 and 20000 then
    raise exception 'fidelite_refusee:parrainage';
  end if;
  update reglages set valeur = to_jsonb(t) where cle = 'fidelite_taux_pourcent';
  update reglages set valeur = to_jsonb(pm) where cle = 'parrainage_montant_centimes';
  update reglages set valeur = to_jsonb(pp) where cle = 'parrainage_plafond_mois';
  -- La marque « proposition » (montant pas encore validé par Jérémy) ne tombe que si le gérant change le minimum.
  update reglages set proposition = proposition and valeur = to_jsonb(pmin), valeur = to_jsonb(pmin) where cle = 'parrainage_minimum_centimes';
  update reglages set valeur = to_jsonb(s) where cle = 'fidelite_seuil_centimes';
  update reglages set valeur = jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(distinct (j #>> '{}')::integer), '[]'::jsonb) from jsonb_array_elements(jours) j),
      'dates', (select coalesce(jsonb_agg(distinct d order by d), '[]'::jsonb) from jsonb_array_elements_text(dates) d))
    where cle = 'fidelite_soirs_doubles';
  perform journaliser(p_personnel, 'fidelite', 'reglages', avant, reglages_fidelite() - 'du_centimes' - 'comptes' - 'active' - 'calcule_le' - 'parrainage_actif');
  return reglages_fidelite();
end;
$$;

revoke execute on function parrainage_actif(), parrainage_minimum(), parrain_qualifie(uuid) from public, anon, authenticated;
grant execute on function parrainage_actif(), parrainage_minimum(), parrain_qualifie(uuid) to service_role;
