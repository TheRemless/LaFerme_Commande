-- Vague 3, bo-commandes : le client appelle pour changer sa commande (décision du chef, 14.11.2026, réponse à Jérémy).
-- Jamais de débit sur la carte du client sans son accord sur le moment.
-- - Commande à encaisser (comptoir, téléphone) : la modification s'applique tout de suite, le total change.
-- - Payée et moins chère : la modification s'applique, la différence est remboursée (Stripe, ou espèces au comptoir).
-- - Payée et plus chère : par défaut un lien de paiement de la différence ; rien ne change avant le paiement reçu
--   (webhook). Repli au choix de l'équipe : complément à encaisser à la porte (livraison) ou au comptoir (retrait).
-- Un seul modèle pour l'argent en plus, la table complements (lien : moyen en_ligne, encaissé au webhook ; porte ;
-- comptoir), lu par la clôture et l'export Crésus comme une vente de la commande. Une commande payée garde son total
-- payé (sous-total, total, TVA) : ses plats changent, l'argent en plus ou en moins est dans complements et
-- remboursements. Gérant, ou responsable de service (droit « modifier_commande »).
--
-- Tables neuves : modifications_commande, complements. Objets recréés, chacun depuis sa dernière définition :
--   livraisons_livreur et file_tablette (20261215120000_commande_telephone.sql) : le complément à encaisser ;
--   cloture_rapport (20261212090000_cloture_moyens.sql, bo-pilotage) : les compléments encaissés par moyen, à
--     encaisser, et un écart « complement_sans_encaissement » ;
--   export_cresus (20261214120000_export_cresus.sql, bo-pilotage) : les compléments encaissés, ventes de plus.
-- Numéro réservé par le chef (plage de bo-commandes). Compatible avant et après : sans modification, rien ne change.

create table modifications_commande (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references commandes (id) on delete cascade,
  cle text not null unique check (length(cle) between 16 and 80),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'appliquee', 'abandonnee', 'payee_non_appliquee')),
  reglement text not null check (reglement in ('aucun', 'lien', 'porte', 'comptoir', 'remboursement')),
  lignes jsonb not null check (jsonb_typeof(lignes) = 'array' and jsonb_array_length(lignes) between 1 and 30),
  ajouts jsonb not null default '[]'::jsonb,
  retires jsonb not null default '[]'::jsonb,
  adresse jsonb,
  details_livraison jsonb,
  zone_numero integer,
  pizzas_seulement boolean not null default false,
  sous_total_centimes integer not null check (sous_total_centimes >= 0),
  frais_centimes integer not null check (frais_centimes >= 0),
  total_centimes integer not null check (total_centimes > 0),
  tva_centimes integer not null check (tva_centimes >= 0),
  ancienne_valeur_centimes integer not null,
  difference_centimes integer not null,
  stripe_session_id text unique,
  stripe_payment_intent text,
  personnel_id uuid references personnel (id) on delete set null,
  personnel_nom text not null,
  cree_le timestamptz not null default now(),
  fini_le timestamptz
);
create index modifications_commande_idx on modifications_commande (commande_id, cree_le);
-- Une seule modification en attente de paiement par commande.
create unique index modifications_commande_attente_idx on modifications_commande (commande_id) where statut = 'en_attente';

create table complements (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references commandes (id) on delete cascade,
  modification_id uuid references modifications_commande (id) on delete set null,
  montant_centimes integer not null check (montant_centimes > 0),
  tva_centimes integer not null check (tva_centimes >= 0),
  moyen text not null check (moyen in ('en_ligne', 'porte', 'comptoir')),
  statut text not null default 'a_encaisser' check (statut in ('a_encaisser', 'encaisse')),
  moyen_encaissement text check (moyen_encaissement in ('stripe', 'especes', 'carte')),
  stripe_payment_intent text,
  cree_le timestamptz not null default now(),
  encaisse_le timestamptz,
  encaisse_par text,
  check ((statut = 'encaisse') = (moyen_encaissement is not null and encaisse_le is not null))
);
create index complements_commande_idx on complements (commande_id);

alter table modifications_commande enable row level security;
alter table complements enable row level security;
revoke all on modifications_commande, complements from anon, authenticated;
grant select, insert, update, delete on modifications_commande, complements to service_role;

-- Valeur actuelle d'une commande : ses plats et ses frais (ce que le client a commandé, avant ou après une
-- modification). Pour une commande payée, différente de total_centimes (le montant payé au départ).
create function valeur_commande(p_commande uuid) returns integer
language sql stable as $$
  select (coalesce((select sum(l.total_centimes) from commande_lignes l where l.commande_id = p_commande), 0)
    + (select frais_centimes from commandes where id = p_commande))::integer;
$$;

-- Applique une modification : nouvelles lignes, adresse, argent (complément ou remboursement), historique, journal.
-- Lien : appelée par le webhook seulement, avec l'événement Stripe (une fois) et le montant payé (égal à la
-- différence). Renvoie applique false si rien n'a été fait (déjà fait, montant faux, commande finie).
create function appliquer_modification(p_modification uuid, p_evenement text default null, p_payment_intent text default null, p_montant integer default null)
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
begin
  select * into m from modifications_commande where id = p_modification for update;
  if not found or m.statut <> 'en_attente' then
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
      return jsonb_build_object('applique', false, 'raison', 'montant');
    end if;
  end if;
  select * into c from commandes where id = m.commande_id for update;
  if c.statut not in ('nouvelle', 'acceptee', 'en_preparation', 'prete') then
    -- Payé par le lien alors que la commande est partie, finie ou annulée : l'argent est là, la modification ne
    -- s'applique pas. Le gérant le voit et rembourse (src/lib/difference.ts l'alerte).
    update modifications_commande set statut = case when m.reglement = 'lien' then 'payee_non_appliquee' else 'abandonnee' end,
      stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent), fini_le = now() where id = m.id;
    return jsonb_build_object('applique', false, 'raison', 'commande_finie', 'a_rembourser', m.reglement = 'lien');
  end if;

  delete from commande_lignes where commande_id = c.id;
  for l in select * from jsonb_array_elements(m.lignes) loop
    i := i + 1;
    insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, prix_choix, retraits, note, pour)
    values (c.id, i, l ->> 'slug', l ->> 'nom', (l ->> 'station')::station, (l ->> 'qte')::smallint, (l ->> 'unitaire_centimes')::integer,
      (l ->> 'total_centimes')::integer, coalesce(l -> 'choix', '{}'::jsonb), l -> 'prix_choix', coalesce(l -> 'retraits', '[]'::jsonb),
      coalesce(l ->> 'note', ''), coalesce(l ->> 'pour', ''));
  end loop;
  update commandes set
    adresse = coalesce(m.adresse, adresse),
    details_livraison = coalesce(m.details_livraison, details_livraison),
    zone_numero = coalesce(m.zone_numero, zone_numero),
    pizzas_seulement = m.pizzas_seulement
  where id = c.id;
  -- Pas encore payée : le client paie le nouveau total au retrait ou à la livraison.
  if c.statut_paiement = 'a_encaisser_retrait' then
    update commandes set sous_total_centimes = m.sous_total_centimes, frais_centimes = m.frais_centimes,
      total_centimes = m.total_centimes, tva_centimes = m.tva_centimes where id = c.id;
  end if;

  if m.reglement in ('lien', 'porte', 'comptoir') then
    insert into complements (commande_id, modification_id, montant_centimes, tva_centimes, moyen, statut, moyen_encaissement, stripe_payment_intent, encaisse_le, encaisse_par)
    values (c.id, m.id, m.difference_centimes, round(m.difference_centimes * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer,
      case when m.reglement = 'lien' then 'en_ligne' else m.reglement end,
      case when m.reglement = 'lien' then 'encaisse' else 'a_encaisser' end,
      case when m.reglement = 'lien' then 'stripe' end, p_payment_intent,
      case when m.reglement = 'lien' then now() end, case when m.reglement = 'lien' then 'stripe' end)
    returning * into k;
  elsif m.reglement = 'remboursement' then
    select coalesce(sum(montant_centimes), 0) into engage from remboursements where commande_id = c.id and statut in ('fait', 'en_cours');
    if engage - m.difference_centimes > c.total_centimes then
      raise exception 'montant_trop_eleve';
    end if;
    insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le)
    values (c.id, 'modification-' || m.id, -m.difference_centimes, 'Commande modifiée à la demande du client',
      case when c.moyen_paiement = 'en_ligne' then 'stripe' else 'especes' end,
      case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
      m.personnel_id, m.personnel_nom, case when c.moyen_paiement = 'en_ligne' then null else now() end)
    returning * into rb;
    if rb.statut = 'fait' then
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
      jsonb_build_object('numero', c.numero, 'valeur_centimes', m.total_centimes, 'reglement', m.reglement));
  return jsonb_build_object('applique', true, 'commande_id', c.id, 'numero', c.numero, 'reglement', m.reglement,
    'difference_centimes', m.difference_centimes, 'ajouts', m.ajouts, 'retires', m.retires,
    'remboursement', case when rb.id is not null then to_jsonb(rb) end, 'complement', case when k.id is not null then to_jsonb(k) end);
end;
$$;

-- Prépare (et applique tout de suite, sauf le lien) une modification calculée par le serveur (src/lib/difference.ts,
-- prix de la base). p : { cle, de, reglement?, lignes, ajouts, retires, sous_total_centimes, frais_centimes,
-- total_centimes, tva_centimes, adresse?, details_livraison?, zone_numero? }.
create function preparer_modification(p_commande uuid, p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  nom text := auteur_droit(p_personnel, 'modifier_commande');
  c commandes%rowtype;
  m modifications_commande%rowtype;
  valeur integer;
  diff integer;
  reg text;
begin
  select * into m from modifications_commande where cle = p ->> 'cle';
  if found then
    if m.commande_id <> p_commande then
      raise exception 'cle_reutilisee';
    end if;
    return to_jsonb(m) || jsonb_build_object('deja', true);
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    raise exception 'commande_inconnue';
  end if;
  if p ->> 'de' is not null and c.statut <> p ->> 'de' then
    raise exception 'deja_change';
  end if;
  if c.statut not in ('nouvelle', 'acceptee', 'en_preparation', 'prete') then
    raise exception 'statut_non_modifiable';
  end if;
  if exists (select 1 from modifications_commande where commande_id = c.id and statut = 'en_attente') then
    raise exception 'modification_en_attente';
  end if;
  valeur := valeur_commande(c.id);
  diff := (p ->> 'total_centimes')::integer - valeur;
  if c.statut_paiement = 'a_encaisser_retrait' then
    reg := 'aucun';
  elsif c.statut_paiement in ('paye', 'encaisse') then
    if diff < 0 then
      reg := 'remboursement';
    elsif diff = 0 then
      reg := 'aucun';
    else
      reg := p ->> 'reglement';
      if reg is null or reg not in ('lien', 'porte', 'comptoir')
         or (reg = 'porte' and c.mode <> 'livraison') or (reg = 'comptoir' and c.mode <> 'retrait') then
        raise exception 'reglement_invalide';
      end if;
    end if;
  else
    raise exception 'paiement_non_modifiable';
  end if;
  insert into modifications_commande (commande_id, cle, reglement, lignes, ajouts, retires, adresse, details_livraison, zone_numero, pizzas_seulement,
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom)
  values (c.id, p ->> 'cle', reg, p -> 'lignes', coalesce(p -> 'ajouts', '[]'::jsonb), coalesce(p -> 'retires', '[]'::jsonb),
    case when jsonb_typeof(p -> 'adresse') = 'object' then p -> 'adresse' end,
    case when jsonb_typeof(p -> 'details_livraison') = 'object' then p -> 'details_livraison' end,
    (p ->> 'zone_numero')::integer, coalesce((p ->> 'pizzas_seulement')::boolean, false),
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, valeur, diff, p_personnel, nom)
  returning * into m;
  if reg = 'lien' then
    return to_jsonb(m) || jsonb_build_object('deja', false, 'applique', false);
  end if;
  return to_jsonb(m) || jsonb_build_object('deja', false) || appliquer_modification(m.id);
end;
$$;

-- Le lien de paiement créé chez Stripe (ou la doublure) pour une modification en attente.
create function lier_session_modification(p_modification uuid, p_session text) returns boolean
language sql as $$
  update modifications_commande set stripe_session_id = p_session where id = p_modification and statut = 'en_attente' and stripe_session_id is null
  returning true;
$$;

-- Lien expiré, paiement échoué, ou l'équipe renonce : la modification ne s'appliquera pas.
create function abandonner_modification(p_modification uuid, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  m modifications_commande%rowtype;
begin
  if p_personnel is not null then
    perform auteur_droit(p_personnel, 'modifier_commande');
  end if;
  update modifications_commande set statut = 'abandonnee', fini_le = now() where id = p_modification and statut = 'en_attente'
    returning * into m;
  return case when m.id is null then jsonb_build_object('abandonnee', false)
    else jsonb_build_object('abandonnee', true, 'stripe_session_id', m.stripe_session_id) end;
end;
$$;

-- Complément encaissé à la porte (le livreur de la commande) ou au comptoir (l'équipe), en espèces ou par carte.
create function encaisser_complement(p_complement uuid, p_moyen text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  pe personnel%rowtype;
  k complements%rowtype;
begin
  if p_moyen not in ('especes', 'carte') then
    raise exception 'moyen_invalide';
  end if;
  select * into pe from personnel where id = p_personnel and actif;
  select * into k from complements where id = p_complement for update;
  if pe.id is null or k.id is null then
    return false;
  end if;
  if not (pe.role in ('service', 'gerant', 'responsable')
          or (pe.role = 'livreur' and exists (select 1 from livraisons l where l.commande_id = k.commande_id and l.livreur_id = pe.id and l.retiree_le is null))) then
    raise exception 'droit_refuse';
  end if;
  update complements set statut = 'encaisse', moyen_encaissement = p_moyen, encaisse_le = now(),
    encaisse_par = case when pe.role = 'livreur' then 'livreur:' else 'tablette:' end || pe.nom
  where id = k.id and statut = 'a_encaisser';
  if not found then
    return false;
  end if;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    select o.id, o.statut, o.statut, case when pe.role = 'livreur' then 'livreur:' else 'tablette:' end || pe.nom,
      'complément encaissé ' || (k.montant_centimes / 100.0)::numeric(10, 2)::text || ' CHF ' || case when p_moyen = 'especes' then 'en espèces' else 'par carte' end
    from commandes o where o.id = k.commande_id;
  return true;
end;
$$;

-- Pour la fiche de la commande au back-office : modifications et compléments.
create function modifications_commande_gestion(p_commande uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'valeur_centimes', valeur_commande(p_commande),
    'modifications', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'statut', m.statut, 'reglement', m.reglement,
        'difference_centimes', m.difference_centimes, 'total_centimes', m.total_centimes, 'par', m.personnel_nom,
        'cree_le', m.cree_le, 'fini_le', m.fini_le, 'lien', m.stripe_session_id is not null) order by m.cree_le)
      from modifications_commande m where m.commande_id = p_commande), '[]'::jsonb),
    'complements', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'montant_centimes', k.montant_centimes, 'moyen', k.moyen,
        'statut', k.statut, 'moyen_encaissement', k.moyen_encaissement, 'encaisse_par', k.encaisse_par, 'encaisse_le', k.encaisse_le) order by k.cree_le)
      from complements k where k.commande_id = p_commande), '[]'::jsonb));
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
        -- Complément à encaisser à la porte (commande modifiée, vague 3, bo-commandes) : le premier non encaissé.
        'complement', (select jsonb_build_object('id', k.id, 'centimes', k.montant_centimes) from complements k
          where k.commande_id = o.id and k.moyen = 'porte' and k.statut = 'a_encaisser' order by k.cree_le limit 1),
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

create or replace function file_tablette() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.cree_le), '[]'::jsonb) from (
    select o.cree_le, jsonb_build_object(
      'id', o.id, 'numero', o.numero, 'cree_le', o.cree_le, 'attend_depuis', coalesce(o.paye_le, o.cree_le),
      'mode', o.mode, 'statut', o.statut,
      'statut_paiement', o.statut_paiement, 'moyen_paiement', o.moyen_paiement, 'canal', o.canal, 'complements', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'centimes', k.montant_centimes, 'moyen', k.moyen) order by k.cree_le), '[]'::jsonb)
        from complements k where k.commande_id = o.id and k.statut = 'a_encaisser'),
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

create or replace function cloture_rapport(p_jour date) returns jsonb
language sql stable as $$
  with bornes as (
    select (p_jour + time '05:00') at time zone 'Europe/Zurich' as debut,
           (p_jour + 1 + time '05:00') at time zone 'Europe/Zurich' as fin
  ),
  jour as (
    select o.* from commandes o
    where o.jour_service = p_jour and o.statut not in ('paiement_en_attente', 'annulee')
  ),
  -- Ce que le client a eu en moins sur une commande pas encore payée au comptoir (manque déduit).
  deductions as (
    select r.commande_id, sum(r.montant_centimes)::bigint as montant
    from remboursements r join jour o on o.id = r.commande_id
    where r.moyen = 'deduction' and r.statut = 'fait'
    group by r.commande_id
  ),
  comptoir as (
    select o.id, o.moyen_comptoir, o.total_centimes - coalesce(d.montant, 0) as encaisse
    from jour o left join deductions d on d.commande_id = o.id
    where o.moyen_paiement = 'comptoir' and o.statut <> 'refusee' and o.statut_paiement in ('encaisse', 'rembourse')
  ),
  rembs as (
    select r.*, o.numero, o.statut as statut_commande, o.moyen_paiement
    from remboursements r join commandes o on o.id = r.commande_id, bornes b
    where (r.statut = 'fait' and r.fait_le >= b.debut and r.fait_le < b.fin)
       or (r.statut <> 'fait' and r.cree_le >= b.debut and r.cree_le < b.fin)
  ),
  -- Compléments des commandes modifiées (vague 3, bo-commandes) : payés par le lien (en ligne), ou encaissés à la
  -- porte ou au comptoir (espèces ou carte). Comptés au jour de service de la commande, comme elle.
  complements_jour as (
    select k.*, o.numero, o.statut as statut_commande
    from complements k join jour o on o.id = k.commande_id
  ),
  especes_rendues as (
    select coalesce(sum(montant_centimes), 0)::bigint as montant from rembs where moyen = 'especes' and statut = 'fait'
  )
  select jsonb_build_object(
    'jour', p_jour,
    'debut', (select debut from bornes),
    'fin', (select fin from bornes),
    'calcule_le', now(),
    'ventes', pilotage_synthese(p_jour, p_jour),
    'encaissements', jsonb_build_object(
      'en_ligne', (
        select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(total_centimes), 0)
          + (select coalesce(sum(montant_centimes), 0) from complements_jour where moyen = 'en_ligne' and statut = 'encaisse'))
        from jour where moyen_paiement = 'en_ligne' and statut <> 'refusee' and statut_paiement in ('paye', 'rembourse')
      ),
      'complements', jsonb_build_object(
        'en_ligne_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where moyen = 'en_ligne' and statut = 'encaisse'),
        'especes_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement = 'especes'),
        'carte_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement = 'carte'),
        'a_encaisser_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'a_encaisser')
      ),
      'comptoir', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir),
      'deductions_centimes', (select coalesce(sum(montant), 0) from deductions),
      'especes_rendues_centimes', (select montant from especes_rendues),
      'attendu_comptoir_centimes', (select coalesce(sum(encaisse), 0) from comptoir) - (select montant from especes_rendues)
        + (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement in ('especes', 'carte')),
      -- Moyen noté par la tablette à l'encaissement (20261203090000_tablette_encaissement.sql) : les espèces
      -- se comparent au tiroir, la carte au ticket du terminal. Non noté : encaissé avant ce changement, ou
      -- par un chemin qui ne le demande pas ; il empêche d'attribuer un écart à l'un ou à l'autre.
      'comptoir_especes', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir where moyen_comptoir = 'especes'),
      'comptoir_carte', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir where moyen_comptoir = 'carte'),
      'comptoir_non_note', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir where moyen_comptoir is null),
      'attendu_especes_centimes', (select coalesce(sum(encaisse), 0) from comptoir where moyen_comptoir = 'especes') - (select montant from especes_rendues)
        + (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement = 'especes'),
      'attendu_carte_centimes', (select coalesce(sum(encaisse), 0) from comptoir where moyen_comptoir = 'carte')
        + (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement = 'carte')
    ),
    'a_encaisser', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', o.numero, 'mode', o.mode, 'statut', o.statut,
        'du_centimes', o.total_centimes - coalesce(d.montant, 0),
        'heure', to_char(coalesce(o.heure_confirmee, o.cree_le) at time zone 'Europe/Zurich', 'HH24:MI')
      ) order by o.numero)
      from jour o left join deductions d on d.commande_id = o.id
      where o.statut_paiement = 'a_encaisser_retrait' and o.statut <> 'refusee'
    ), '[]'::jsonb),
    'remboursements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', numero, 'montant_centimes', montant_centimes, 'moyen', moyen, 'statut', statut, 'motif', motif,
        'par', personnel_nom, 'commande_refusee', statut_commande = 'refusee', 'erreur', erreur,
        'heure', to_char(coalesce(fait_le, cree_le) at time zone 'Europe/Zurich', 'HH24:MI')
      ) order by coalesce(fait_le, cree_le))
      from rembs
    ), '[]'::jsonb),
    'ecarts', coalesce((
      select jsonb_agg(e.j order by e.ordre, e.numero) from (
        select 1 as ordre, o.numero, jsonb_build_object('type', 'remise_sans_encaissement', 'numero', o.numero,
          'centimes', o.total_centimes - coalesce(d.montant, 0)) as j
        from jour o left join deductions d on d.commande_id = o.id
        where o.statut = 'terminee' and o.statut_paiement = 'a_encaisser_retrait'
        union all
        select 2, numero, jsonb_build_object('type', 'remboursement_' || statut, 'numero', numero, 'centimes', montant_centimes)
        from rembs where statut in ('echec', 'en_cours')
        union all
        select 3, o.numero, jsonb_build_object('type', 'pas_terminee', 'numero', o.numero, 'statut', o.statut, 'centimes', o.total_centimes)
        from jour o where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
        union all
        -- À vérifier : un complément à la porte ou au comptoir qui n'a pas été marqué encaissé.
        select 4, numero, jsonb_build_object('type', 'complement_sans_encaissement', 'numero', numero, 'centimes', montant_centimes, 'moyen', moyen)
        from complements_jour where statut = 'a_encaisser' and statut_commande not in ('refusee', 'annulee')
      ) e
    ), '[]'::jsonb)
  );
$$;

create or replace function export_cresus(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, o.taux_tva_pourcent as taux,
      case when o.moyen_paiement = 'en_ligne' then 'stripe' when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      o.total_centimes, o.tva_centimes, o.frais_centimes,
      round(o.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva_frais
    from commandes o
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
  ),
  -- Compléments des commandes modifiées (vague 3, bo-commandes) : une vente de plus, au jour de la commande, au moyen
  -- de son encaissement (lien : Stripe ; à la porte ou au comptoir : caisse ou terminal), TVA au taux de la commande.
  complements_v as (
    select o.jour, o.taux_tva_pourcent as taux,
      case when k.moyen = 'en_ligne' then 'stripe' when k.moyen_encaissement = 'carte' then 'terminal' else 'caisse' end as moyen,
      k.montant_centimes as total_centimes, k.tva_centimes, 0 as frais_centimes, 0 as tva_frais
    from complements k join commandes o on o.id = k.commande_id
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, o.taux_tva_pourcent as taux,
      case when r.moyen = 'stripe' then 'stripe' when r.moyen = 'especes' then 'caisse'
           when o.moyen_comptoir = 'carte' then 'terminal' else 'caisse' end as moyen,
      r.montant_centimes,
      round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  lignes as (
    select jour, taux, 'vente' as sorte, moyen, count(*) as nombre, sum(total_centimes) as ttc, sum(tva_centimes) as tva,
      sum(frais_centimes) as frais, sum(tva_frais) as tva_frais
    from (select * from ventes union all select * from complements_v) v group by jour, taux, moyen
    union all
    select jour, taux, 'remboursement', moyen, count(*), sum(montant_centimes), sum(tva), 0, 0
    from rembs group by jour, taux, moyen
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', jour, 'taux_tva_pourcent', taux, 'sorte', sorte, 'moyen', moyen, 'nombre', nombre,
    'ttc_centimes', ttc, 'tva_centimes', tva, 'frais_centimes', frais, 'tva_frais_centimes', tva_frais
  ) order by jour, sorte desc, moyen, taux), '[]'::jsonb)
  from lignes;
$$;

revoke execute on function valeur_commande(uuid), appliquer_modification(uuid, text, text, integer), preparer_modification(uuid, jsonb, uuid),
  lier_session_modification(uuid, text), abandonner_modification(uuid, uuid), encaisser_complement(uuid, text, uuid),
  modifications_commande_gestion(uuid) from public, anon, authenticated;
grant execute on function valeur_commande(uuid), appliquer_modification(uuid, text, text, integer), preparer_modification(uuid, jsonb, uuid),
  lier_session_modification(uuid, text), abandonner_modification(uuid, uuid), encaisser_complement(uuid, text, uuid),
  modifications_commande_gestion(uuid) to service_role;
