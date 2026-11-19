-- Plan de conformité comptable, lot 5 (docs/compta/plan-conformite.md, bo-commandes), règle R21 : rien d'effaçable,
-- chaque modification tracée (Olico art. 3 et 9). Demande de bo-pilotage du 19.11.2026.
--
-- Avant : changer les plats d'une commande effaçait ses lignes (delete from commande_lignes) sans les garder, et un
-- complément encore dû ramené à zéro par une baisse était supprimé.
-- Maintenant :
--   modifications_commande garde l'état d'avant : lignes_avant (les lignes telles qu'elles étaient), commande_avant
--     (adresse, zone, frais, totaux, TVA), complements_avant (les compléments encore dus, avant la baisse) ;
--   un complément ramené à zéro passe au statut 'annule' (annule_le, annule_par_modification), son montant gardé.
-- Les lectures des compléments filtrent déjà 'encaisse' ou 'a_encaisser' (clôture, exports, récapitulatif, livreur),
-- sauf pilotage_synthese : voir bo-pilotage (PR 1 du plan).
--
-- Règle R16 : un plat offert (geste après une réclamation) se choisit dans la carte et garde sa valeur. Posé sur une
-- commande, il y entre comme une ligne à 0 CHF marquée « offert » (aucune TVA de plus, art. 31 al. 2 let. c LTVA), qui
-- survit aux modifications de la commande. Chaque plat offert reste tracé par client avec sa valeur ; la fiche de
-- réclamation donne le total offert au client dans l'année (seuil de 500 CHF par personne et par an).
--
-- Objets recréés, chacun depuis sa dernière définition : appliquer_modification (20261216140000),
-- noter_geste_reclamation et fiche_reclamation_gestion (20261213190000), modifications_commande_gestion (20261215130000), appliquer_geste et gestes_en_attente
-- (20261127130000).
-- Numéro donné par le chef.

alter table modifications_commande add column lignes_avant jsonb, add column commande_avant jsonb, add column complements_avant jsonb;

alter table complements drop constraint complements_statut_check;
alter table complements add constraint complements_statut_check check (statut in ('a_encaisser', 'encaisse', 'annule'));
alter table complements add column annule_le timestamptz, add column annule_par_modification uuid references modifications_commande (id) on delete set null;
alter table complements add constraint complements_annule_check check ((statut = 'annule') = (annule_le is not null));

-- R16 : plat offert choisi dans la carte, avec sa valeur au moment du geste puis au moment où il est posé.
alter table commande_lignes add column offert boolean not null default false;
alter table commande_lignes add constraint commande_lignes_offert_gratuit check (not offert or total_centimes = 0);
alter table gestes_client add column plat_slug text, add column plat_nom text,
  add column valeur_centimes integer check (valeur_centimes >= 0), add column offert_valeur_centimes integer check (offert_valeur_centimes >= 0),
  add column offert_ligne_id uuid references commande_lignes (id) on delete set null;

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
  offerts jsonb;
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
  offerts := (select coalesce(jsonb_agg(to_jsonb(lo) order by lo.position), '[]'::jsonb) from commande_lignes lo where lo.commande_id = c.id and lo.offert);
  delete from commande_lignes where commande_id = c.id;
  for l in select * from jsonb_array_elements(m.lignes) loop
    i := i + 1;
    insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, prix_choix, retraits, note, pour)
    values (c.id, i, l ->> 'slug', l ->> 'nom', (l ->> 'station')::station, (l ->> 'qte')::smallint, (l ->> 'unitaire_centimes')::integer,
      (l ->> 'total_centimes')::integer, coalesce(l -> 'choix', '{}'::jsonb), l -> 'prix_choix', coalesce(l -> 'retraits', '[]'::jsonb),
      coalesce(l ->> 'note', ''), coalesce(l ->> 'pour', ''));
  end loop;
  -- R16 : un plat offert reste dans la commande, à 0 CHF, quoi que le client change.
  for l in select * from jsonb_array_elements(offerts) loop
    i := i + 1;
    insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, choix, prix_choix, retraits, note, pour, offert)
    values (c.id, i, l ->> 'plat_slug', l ->> 'nom', (l ->> 'station')::station, (l ->> 'qte')::smallint, 0, 0, coalesce(l -> 'choix', '{}'::jsonb),
      l -> 'prix_choix', coalesce(l -> 'retraits', '[]'::jsonb), coalesce(l ->> 'note', ''), coalesce(l ->> 'pour', ''), true);
  end loop;
  update commandes set
    adresse = coalesce(m.adresse, adresse),
    details_livraison = coalesce(m.details_livraison, details_livraison),
    zone_numero = coalesce(m.zone_numero, zone_numero),
    pizzas_seulement = m.pizzas_seulement
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
    values (c.id, m.id, m.difference_centimes, round(m.difference_centimes * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer,
      least(greatest(m.frais_centimes - frais_avant, 0), m.difference_centimes),
      case when m.reglement = 'lien' then 'en_ligne' else m.reglement end,
      case when m.reglement = 'lien' then 'encaisse' else 'a_encaisser' end,
      case when m.reglement = 'lien' then 'stripe' end, p_payment_intent,
      case when m.reglement = 'lien' then now() end, case when m.reglement = 'lien' then 'stripe' end)
    returning * into k;
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
        update complements set montant_centimes = x.montant_centimes - reste,
          tva_centimes = round((x.montant_centimes - reste) * c.taux_tva_pourcent / (100 + c.taux_tva_pourcent))::integer,
          frais_centimes = least(x.frais_centimes, x.montant_centimes - reste)
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
    insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le)
    values (c.id, 'modification-' || m.id, part, 'Commande modifiée à la demande du client',
      case when c.moyen_paiement = 'en_ligne' then 'stripe'
        else coalesce(m.moyen_remboursement, case when c.moyen_comptoir = 'carte' then 'terminal' else 'especes' end) end,
      case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
      m.personnel_id, m.personnel_nom, case when c.moyen_paiement = 'en_ligne' then null else now() end)
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
      insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, payment_intent_cible, complement_id)
      values (c.id, 'modification-' || m.id || '-c' || left(y.id::text, 8), part, 'Commande modifiée à la demande du client', 'stripe', 'en_cours',
        m.personnel_id, m.personnel_nom, y.stripe_payment_intent, y.id)
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
      insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, complement_id, fait_le)
      values (c.id, 'modification-' || m.id || '-c' || left(y.id::text, 8), part, 'Commande modifiée à la demande du client',
        coalesce(m.moyen_remboursement, case when y.moyen_encaissement = 'carte' then 'terminal' else 'especes' end), 'fait',
        m.personnel_id, m.personnel_nom, y.id, now())
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

-- p : { geste: remboursement | plat_offert | reduction | aucun, detail?, remboursement_id?, type?, valeur?, plat_slug? }
-- plat_offert : plat_slug (un plat de la carte) obligatoire, detail facultatif (une précision).
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
  pl plats%rowtype;
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
    -- R16 : le plat se choisit dans la carte, sa valeur vient de la base ; le détail devient une précision facultative.
    select * into pl from plats where slug = p ->> 'plat_slug' and archive_le is null;
    if not found then
      raise exception 'plat_inconnu';
    end if;
    if length(d) > 200 then
      raise exception 'detail_invalide';
    end if;
    d := case when length(d) >= 3 then pl.nom || ', ' || d else pl.nom end;
    insert into gestes_client (email, reclamation_id, detail, cree_par, plat_slug, plat_nom, valeur_centimes)
      values (r.email, r.id, left(d, 200), nom, pl.slug, pl.nom, pl.prix_centimes);
    d := left(d, 200) || ' (valeur CHF ' || (pl.prix_centimes / 100.0)::numeric(10, 2)::text || ')';
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

-- Posé sur une commande en cours : une ligne à 0 CHF marquée « offert » (si le geste dit le plat), sa valeur du jour notée.
-- Les gestes d'avant R16 (texte seul) restent posés comme avant, sans ligne.
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
  if c.statut not in ('nouvelle', 'acceptee', 'en_preparation') then
    raise exception 'statut_non_modifiable';
  end if;
  if g.plat_slug is not null then
    select * into pl from plats where slug = g.plat_slug;
    insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, note, offert)
    values (c.id, coalesce((select max(position) from commande_lignes where commande_id = c.id), 0) + 1, g.plat_slug, g.plat_nom,
      coalesce(pl.station, 'cuisine'), 1, 0, 0, 'Offert', true)
    returning id into ligne;
  end if;
  update gestes_client set offert_commande_id = c.id, offert_par = nom, offert_le = now(), offert_ligne_id = ligne,
    offert_valeur_centimes = coalesce(pl.prix_centimes, g.valeur_centimes)
    where id = g.id;
  insert into evenements_commande (commande_id, de, vers, par, detail)
    values (c.id, c.statut, c.statut, 'tablette:' || nom, 'geste offert ' || g.detail);
  return true;
end;
$$;

create or replace function gestes_en_attente(p_email text) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'detail', g.detail, 'plat_slug', g.plat_slug, 'plat_nom', g.plat_nom,
      'valeur_centimes', g.valeur_centimes, 'cree_par', g.cree_par, 'cree_le', g.cree_le) order by g.cree_le), '[]'::jsonb)
  from gestes_client g
  where gestes_actifs() and g.email = lower(btrim(coalesce(p_email, ''))) and g.offert_le is null;
$$;

-- Valeur des plats offerts à un client dans l'année civile (Europe/Zurich), posés ou promis : celle du jour où il a été
-- posé, sinon celle du geste. Pour le seuil de 500 CHF par personne et par an.
create or replace function plats_offerts_annee(p_email text, p_annee integer default null) returns integer
language sql stable as $$
  select coalesce(sum(coalesce(g.offert_valeur_centimes, g.valeur_centimes, 0)), 0)::integer
  from gestes_client g
  where g.email = lower(btrim(coalesce(p_email, '')))
    and extract(year from coalesce(g.offert_le, g.cree_le) at time zone 'Europe/Zurich')
      = coalesce(p_annee, extract(year from now() at time zone 'Europe/Zurich')::integer);
$$;

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
    -- R16 : les plats qu'on peut offrir (carte en vente) et ce qui a déjà été offert au client cette année.
    'plats_offrables', case when gestes_actifs() then coalesce((select jsonb_agg(jsonb_build_object('slug', pl.slug, 'nom', pl.nom, 'prix_centimes', pl.prix_centimes)
        order by pl.nom) from plats pl where pl.archive_le is null and pl.commandable), '[]'::jsonb) else '[]'::jsonb end,
    'offerts_annee_centimes', plats_offerts_annee(x.email),
    'codes_actifs', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'codes_promo_actifs'), false),
    'code', (select jsonb_build_object('code', k.code, 'type', k.type, 'valeur', k.valeur, 'actif', k.actif,
        'utilise_commande', (select o.numero from utilisations_codes u join commandes o on o.id = u.commande_id
          where u.code_id = k.id and commande_compte(o) order by u.cree_le limit 1))
      from codes_promo k where k.id = x.code_id)
  )
  from reclamations x where x.id = p_id;
$$;

revoke execute on function plats_offerts_annee(text, integer) from public, anon, authenticated;
grant execute on function plats_offerts_annee(text, integer) to service_role;

-- Changer les plats : les lignes offertes ne sont pas proposées au changement (elles restent, voir appliquer_modification).
create or replace function modifications_commande_gestion(p_commande uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'valeur_centimes', valeur_commande(p_commande),
    'frais_centimes', frais_commande(p_commande),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object('slug', l.plat_slug, 'nom', l.nom, 'qte', l.qte, 'choix', l.choix,
        'retraits', l.retraits, 'note', l.note, 'total_centimes', l.total_centimes) order by l.position)
      from commande_lignes l where l.commande_id = p_commande and not l.offert), '[]'::jsonb),
    -- R16 : les plats offerts, à part (ils ne se changent pas et ne se paient pas).
    'offerts', coalesce((select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte) order by l.position)
      from commande_lignes l where l.commande_id = p_commande and l.offert), '[]'::jsonb),
    'modifications', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'statut', m.statut, 'reglement', m.reglement,
        'difference_centimes', m.difference_centimes, 'total_centimes', m.total_centimes, 'par', m.personnel_nom,
        'cree_le', m.cree_le, 'fini_le', m.fini_le, 'lien', m.stripe_session_id is not null) order by m.cree_le)
      from modifications_commande m where m.commande_id = p_commande), '[]'::jsonb),
    'complements', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'montant_centimes', k.montant_centimes, 'moyen', k.moyen,
        'statut', k.statut, 'moyen_encaissement', k.moyen_encaissement, 'encaisse_par', k.encaisse_par, 'encaisse_le', k.encaisse_le) order by k.cree_le)
      from complements k where k.commande_id = p_commande), '[]'::jsonb));
$$;
