-- Vague 3, bo-commandes : geste « réduction sur la prochaine commande » après une réclamation.
-- Décision de Jérémy (13.11.2026, par le chef) : éviter les remboursements, proposer d'abord un plat offert ou
-- une réduction. Le gérant choisit au moment du geste un montant ou un pourcentage (aucune valeur par défaut).
-- Le geste crée un code promo personnel (codes promo de bo-carte) : utilisable une fois, par ce client seul.
-- Désactivé tant que gestes_commerciaux_actifs (D3) est faux, et tant que codes_promo_actifs est faux (sans lui,
-- le site ne propose pas de champ « Code » au client).
--
-- Tables partagées, ajouts seuls : trois colonnes en fin de codes_promo (bo-carte), une contrainte et une colonne
-- sur reclamations (bo-commandes). Objets recréés, chacun depuis sa dernière définition :
--   evaluer_code (bo-carte, depuis 20261210180000_codes_promo_commande.sql) : seul ajout, un code lié à un client
--     n'est accepté que pour son e-mail ou son téléphone (contrôlé juste après la recherche du code : un autre client
--     reçoit « inconnu », comme pour un code qui n'existe pas) ;
--   modifier_code (bo-carte, depuis 20261210120000_codes_promo.sql) : seul changement, l'e-mail et le téléphone
--     du client ne vont pas au journal (demande de bo-carte) ;
--   noter_geste_reclamation, fiche_reclamation_gestion (depuis 20261127130000_reclamations.sql) ;
--   donnees_gestion_client (depuis 20261127120000_clients.sql) et effacer_notes_client
--     (depuis 20261213180000_marque_effacee_avec_compte.sql) : nLPD, codes personnels et plats offerts.
-- Compatible avant et après : mêmes signatures, droits gardés (create or replace).

alter table codes_promo add column client_email text check (client_email is null or client_email = lower(btrim(client_email)));
alter table codes_promo add column client_telephone text;
alter table codes_promo add column reclamation_id uuid references reclamations (id) on delete set null;
create index codes_promo_client_idx on codes_promo (client_email) where client_email is not null;

alter table reclamations drop constraint reclamations_geste_check;
alter table reclamations add constraint reclamations_geste_check check (geste in ('remboursement', 'plat_offert', 'reduction', 'aucun'));
alter table reclamations add column code_id uuid references codes_promo (id) on delete set null;

-- ---------- Codes promo : un code personnel n'est valable que pour son client ----------

create or replace function evaluer_code(p jsonb) returns jsonb
language plpgsql stable as $$
declare
  c codes_promo%rowtype;
  aujourdhui date := (now() at time zone 'Europe/Zurich')::date;
  v_code text := upper(btrim(coalesce(p ->> 'code', '')));
  v_email text := email_normal(p ->> 'email');
  v_tel text := telephone_normal(p ->> 'telephone');
  v_adr text := adresse_cle(case when jsonb_typeof(p -> 'adresse') = 'object' then p -> 'adresse' end);
  v_sous_total integer := greatest(coalesce((p ->> 'sous_total_centimes')::integer, 0), 0);
  v_frais integer := greatest(coalesce((p ->> 'frais_centimes')::integer, 0), 0);
  remise integer;
begin
  if coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false) is not true then
    return jsonb_build_object('ok', false, 'raison', 'desactive');
  end if;
  select * into c from codes_promo where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'inconnu');
  end if;
  -- Code personnel (geste après une réclamation, bo-commandes) : seulement pour l'e-mail ou le téléphone du client.
  -- Pour un autre client, le code n'existe pas (rien ne dit qu'il est réservé à quelqu'un). Sans e-mail ni
  -- téléphone (panier), la suite vaut comme pour « une fois par client » : à vérifier au paiement.
  if (c.client_email is not null or c.client_telephone is not null) and (v_email is not null or v_tel is not null)
    and not (coalesce(v_email = c.client_email, false) or coalesce(v_tel = c.client_telephone, false)) then
    return jsonb_build_object('ok', false, 'raison', 'inconnu');
  end if;
  if not c.actif then
    return jsonb_build_object('ok', false, 'raison', 'inactif');
  end if;
  if c.debut is not null and aujourdhui < c.debut then
    return jsonb_build_object('ok', false, 'raison', 'pas_commence');
  end if;
  if c.fin is not null and aujourdhui > c.fin then
    return jsonb_build_object('ok', false, 'raison', 'expire');
  end if;
  if v_sous_total < c.minimum_centimes then
    return jsonb_build_object('ok', false, 'raison', 'minimum', 'minimum_centimes', c.minimum_centimes);
  end if;
  if c.type = 'livraison' and (p ->> 'mode' is distinct from 'livraison' or v_frais = 0) then
    return jsonb_build_object('ok', false, 'raison', 'retrait');
  end if;
  if c.plafond_utilisations is not null and (
    select count(*) from utilisations_codes u join commandes x on x.id = u.commande_id
    where u.code_id = c.id and commande_compte(x)
  ) >= c.plafond_utilisations then
    return jsonb_build_object('ok', false, 'raison', 'plafond');
  end if;
  if (c.une_fois_par_client or c.premiere_commande) and v_email is null and v_tel is null then
    if coalesce((p ->> 'provisoire')::boolean, false) then
      return jsonb_build_object('ok', true, 'code', c.code, 'type', c.type, 'a_verifier', true,
        'remise_centimes', case c.type
          when 'pourcentage' then round(v_sous_total * c.valeur / 100.0)::integer
          when 'montant' then least(c.valeur, v_sous_total)
          else v_frais end);
    end if;
    return jsonb_build_object('ok', false, 'raison', 'client_inconnu');
  end if;
  if c.une_fois_par_client and exists (
    select 1 from utilisations_codes u join commandes x on x.id = u.commande_id
    where u.code_id = c.id and commande_compte(x)
      and (email_normal(x.client_email) = v_email or telephone_normal(x.client_telephone) = v_tel or adresse_cle(x.adresse) = v_adr)
  ) then
    return jsonb_build_object('ok', false, 'raison', 'deja_utilise');
  end if;
  if c.premiere_commande and (
    exists (select 1 from commandes x where email_normal(x.client_email) = v_email and commande_compte(x))
    or exists (select 1 from commandes x where telephone_normal(x.client_telephone) = v_tel and commande_compte(x))
    or (v_adr is not null and exists (select 1 from commandes x where adresse_cle(x.adresse) = v_adr and commande_compte(x)))
  ) then
    return jsonb_build_object('ok', false, 'raison', 'pas_premiere');
  end if;
  remise := case c.type
    when 'pourcentage' then round(v_sous_total * c.valeur / 100.0)::integer
    when 'montant' then least(c.valeur, v_sous_total)
    else v_frais end;
  return jsonb_build_object('ok', true, 'code', c.code, 'type', c.type, 'remise_centimes', remise);
end;
$$;

-- ---------- Modifier un code : jamais les coordonnées du client au journal ----------

create or replace function modifier_code(p_code text, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  avant codes_promo%rowtype;
  apres codes_promo%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into avant from codes_promo where code = p_code for update;
  if not found then
    return false;
  end if;
  if (p ? 'type' or p ? 'valeur') and exists (select 1 from utilisations_codes where code_id = avant.id) then
    raise exception 'code_deja_utilise';
  end if;
  update codes_promo set
    libelle = case when p ? 'libelle' then btrim(p ->> 'libelle') else libelle end,
    actif = coalesce((p ->> 'actif')::boolean, actif),
    type = coalesce(p ->> 'type', type),
    valeur = case when p ? 'valeur' then (p ->> 'valeur')::integer else valeur end,
    minimum_centimes = coalesce((p ->> 'minimum_centimes')::integer, minimum_centimes),
    debut = case when p ? 'debut' then (p ->> 'debut')::date else debut end,
    fin = case when p ? 'fin' then (p ->> 'fin')::date else fin end,
    plafond_utilisations = case when p ? 'plafond_utilisations' then (p ->> 'plafond_utilisations')::integer else plafond_utilisations end,
    premiere_commande = coalesce((p ->> 'premiere_commande')::boolean, premiere_commande),
    une_fois_par_client = coalesce((p ->> 'une_fois_par_client')::boolean, une_fois_par_client)
  where id = avant.id
  returning * into apres;
  -- Un code personnel (geste) : ni l'e-mail ni le téléphone du client au journal.
  perform journaliser(p_personnel, 'code_promo', p_code, to_jsonb(avant) - 'id' - 'cree_le' - 'client_email' - 'client_telephone',
    to_jsonb(apres) - 'id' - 'cree_le' - 'client_email' - 'client_telephone');
  return true;
end;
$$;

-- ---------- Geste ----------

-- p : { geste: remboursement | plat_offert | reduction | aucun, detail?, remboursement_id?, type?, valeur? }
-- reduction : type montant (valeur en centimes, plus de 0) ou pourcentage (1 à 100). Crée le code personnel
-- LAFERME-XXXXXXXX, une utilisation, lié à l'e-mail et au téléphone de la commande. Sans date de fin.
create or replace function noter_geste_reclamation(p_id uuid, p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := gerant_nom(p_personnel);
  r reclamations%rowtype;
  g text := p ->> 'geste';
  d text := btrim(coalesce(p ->> 'detail', ''));
  rb remboursements%rowtype;
  t text := p ->> 'type';
  v integer;
  code_net text;
  code_ref uuid;
begin
  select * into r from reclamations where id = p_id for update;
  if not found then
    raise exception 'reclamation_inconnue';
  end if;
  if r.statut = 'close' then
    raise exception 'reclamation_close';
  end if;
  if r.geste is not null then
    raise exception 'geste_deja_note';
  end if;
  if g = 'remboursement' then
    select * into rb from remboursements where id = (p ->> 'remboursement_id')::uuid;
    if not found or rb.commande_id is distinct from r.commande_id or rb.statut = 'echec' then
      raise exception 'remboursement_invalide';
    end if;
    d := (rb.montant_centimes / 100.0)::numeric(10, 2)::text || ' CHF, ' || rb.motif;
  elsif g = 'plat_offert' then
    if not gestes_actifs() then
      raise exception 'gestes_desactives';
    end if;
    if length(d) < 3 or length(d) > 200 then
      raise exception 'detail_invalide';
    end if;
    insert into gestes_client (email, reclamation_id, detail, cree_par) values (r.email, r.id, d, nom);
  elsif g = 'reduction' then
    if not gestes_actifs() then
      raise exception 'gestes_desactives';
    end if;
    if not coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false) then
      raise exception 'codes_desactives';
    end if;
    if coalesce(jsonb_typeof(p -> 'valeur'), '') <> 'number' or coalesce(p ->> 'valeur', '') !~ '^[0-9]{1,7}$' then
      raise exception 'reduction_invalide';
    end if;
    v := (p ->> 'valeur')::integer;
    if t is null or v is null or not ((t = 'pourcentage' and v between 1 and 100) or (t = 'montant' and v > 0)) then
      raise exception 'reduction_invalide';
    end if;
    -- creer_code de bo-carte (validation, journal « code_promo » sans coordonnées) ; le code naît inactif. Puis il
    -- est lié au client et allumé ici, sans modifier_code (rien à journaliser de plus que le geste).
    loop
      code_net := 'LAFERME-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from codes_promo where code = code_net);
    end loop;
    perform creer_code(jsonb_build_object('code', code_net, 'libelle', 'Geste après une réclamation', 'type', t, 'valeur', v,
      'minimum_centimes', 0, 'debut', (now() at time zone 'Europe/Zurich')::date, 'plafond_utilisations', 1,
      'premiere_commande', false, 'une_fois_par_client', true), p_personnel);
    update codes_promo set actif = true, client_email = email_normal(r.email),
        client_telephone = (select telephone_normal(c.client_telephone) from commandes c where c.id = r.commande_id), reclamation_id = r.id
      where code = code_net
      returning id into code_ref;
    d := case t when 'montant' then 'CHF ' || (v / 100.0)::numeric(10, 2)::text else v::text || ' %' end
      || ' sur la prochaine commande, code ' || code_net;
  elsif g = 'aucun' then
    if length(d) < 3 or length(d) > 200 then
      raise exception 'detail_invalide';
    end if;
  else
    raise exception 'geste_invalide';
  end if;
  update reclamations set geste = g, geste_detail = d, remboursement_id = rb.id, code_id = code_ref,
      statut = case when statut = 'ouverte' then 'en_cours' else statut end
    where id = p_id;
  insert into suivis_reclamation (reclamation_id, par, texte) values (p_id, nom,
    case g when 'remboursement' then 'Geste : remboursement de ' || d when 'plat_offert' then 'Geste : offert à la prochaine commande, ' || d
      when 'reduction' then 'Geste : réduction de ' || d else 'Pas de geste : ' || d end);
  perform journaliser(p_personnel, 'reclamation', p_id::text, null, jsonb_build_object('geste', g, 'detail', d));
  return (select to_jsonb(x) from reclamations x where x.id = p_id);
end;
$$;

-- ---------- Lecture : la fiche dit le code, s'il a servi, et si les codes sont allumés ----------

create or replace function fiche_reclamation_gestion(p_id uuid) returns jsonb
language sql stable as $$
  select to_jsonb(x) || jsonb_build_object(
    'commande', (select jsonb_build_object('id', c.id, 'numero', c.numero, 'jour_service', c.jour_service, 'statut', c.statut, 'mode', c.mode,
        'total_centimes', c.total_centimes, 'client_prenom', c.client_prenom, 'client_nom', c.client_nom, 'client_telephone', c.client_telephone)
      from commandes c where c.id = x.commande_id),
    'suivis', coalesce((select jsonb_agg(jsonb_build_object('par', s.par, 'texte', s.texte, 'le', s.le) order by s.le, s.id) from suivis_reclamation s where s.reclamation_id = x.id), '[]'::jsonb),
    'remboursements', coalesce((select jsonb_agg(jsonb_build_object('id', rb.id, 'montant_centimes', rb.montant_centimes, 'motif', rb.motif, 'statut', rb.statut, 'cree_le', rb.cree_le) order by rb.cree_le)
      from remboursements rb where rb.commande_id = x.commande_id and rb.statut <> 'echec'), '[]'::jsonb),
    'autres', (select count(*) from reclamations y where y.email = x.email and y.id <> x.id),
    'gestes_actifs', gestes_actifs(),
    'codes_actifs', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false),
    'code', (select jsonb_build_object('code', k.code, 'type', k.type, 'valeur', k.valeur, 'actif', k.actif,
        'utilise_commande', (select o.numero from utilisations_codes u join commandes o on o.id = u.commande_id
          where u.code_id = k.id and commande_compte(o) order by u.cree_le limit 1))
      from codes_promo k where k.id = x.code_id)
  )
  from reclamations x where x.id = p_id;
$$;

-- ---------- nLPD : les gestes en attente partent dans l'export et avec le compte ----------

create or replace function donnees_gestion_client(p_email text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('texte', nc.texte, 'cree_le', nc.cree_le) order by nc.cree_le)
      from notes_client nc where nc.email = lower(btrim(coalesce(p_email, '')))), '[]'::jsonb),
    'marque', (select jsonb_build_object('marque', m.marque, 'motif', m.motif, 'le', m.le) from marques_client m where m.email = lower(btrim(coalesce(p_email, '')))),
    'plats_offerts', coalesce((select jsonb_agg(jsonb_build_object('detail', g.detail, 'cree_le', g.cree_le, 'offert_le', g.offert_le) order by g.cree_le)
      from gestes_client g where g.email = lower(btrim(coalesce(p_email, '')))), '[]'::jsonb),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'type', k.type, 'valeur', k.valeur, 'cree_le', k.cree_le) order by k.cree_le)
      from codes_promo k where k.client_email = email_normal(p_email)), '[]'::jsonb));
$$;

-- À la suppression du compte : notes, marque, plats offerts en attente et codes personnels pas encore utilisés.
-- Un code déjà utilisé reste pour l'historique de la commande, éteint et détaché du client.
create or replace function effacer_notes_client(p_email text) returns integer
language plpgsql as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  n integer;
begin
  delete from notes_client where email = e;
  get diagnostics n = row_count;
  delete from marques_client where email = e;
  delete from gestes_client where email = e and offert_le is null;
  delete from codes_promo k where k.client_email = email_normal(e)
    and not exists (select 1 from utilisations_codes u where u.code_id = k.id);
  update codes_promo set actif = false, client_email = null, client_telephone = null where client_email = email_normal(e);
  -- Les lignes du journal qui nomment ce client par ses notes ou par sa marque (motif) partent aussi.
  delete from journal_gestion where objet in ('note_client', 'client') and cle = e;
  return n;
end;
$$;
