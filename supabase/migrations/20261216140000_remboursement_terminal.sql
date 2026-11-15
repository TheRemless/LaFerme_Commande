-- Vague 3, bo-commandes : rendre l'argent par le moyen qui l'a encaissé (décision du chef du 15.11.2026, choix laissé
-- par Jérémy). Payé par carte au comptoir ou à la porte : rendu sur le terminal ; en espèces : en espèces. Proposé
-- par défaut, l'équipe peut changer au moment d'une baisse (client qui préfère des espèces), noté au journal.
--
-- Tables partagées, ajouts seuls : moyen « terminal » admis dans remboursements (contrainte), colonne
-- modifications_commande.moyen_remboursement. Objets recréés, chacun depuis sa dernière définition :
--   preparer_modification (20261215130000) et appliquer_modification (20261216130000) : le moyen choisi ou par défaut ;
--     une baisse se rend aussi sur un complément encaissé à la porte ou au comptoir (relecture de bo-pilotage) ;
--   maj_rembourse (20261114090000) : remboursée seulement quand le départ et les compléments encaissés sont rendus ;
--   demander_remboursement (20261213200000) : par défaut le moyen de l'encaissement au comptoir ;
--   cloture_rapport (20261215130000) : « terminal_rendu_centimes », déduit de l'attendu au comptoir et en carte ;
--   export_cresus (20261215130000) : un remboursement sur le terminal sort du compte du terminal ;
--   export_recap_jours et pilotage_synthese (20261215140000) : colonne et total du rendu sur le terminal.
-- Hors de ce lot : signaler_manque (tablette) rend toujours en espèces une commande déjà encaissée.
-- Numéro donné par le chef. Mêmes signatures, droits gardés (create or replace).

alter table remboursements drop constraint remboursements_moyen_check;
alter table remboursements add constraint remboursements_moyen_check check (moyen in ('stripe', 'especes', 'deduction', 'terminal'));
alter table modifications_commande add column moyen_remboursement text check (moyen_remboursement in ('especes', 'terminal'));

create or replace function preparer_modification(p_commande uuid, p jsonb, p_personnel uuid) returns jsonb
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
  -- La commande a changé depuis le calcul du serveur (une autre modification) : les ajouts seraient faux.
  if p ? 'valeur_avant' and (p ->> 'valeur_avant')::integer <> valeur then
    raise exception 'deja_change';
  end if;
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
  -- Moyen de rendre une baisse payée au comptoir ou à la porte : choisi par l'équipe, sinon celui de l'encaissement.
  if p ->> 'moyen_remboursement' is not null and p ->> 'moyen_remboursement' not in ('especes', 'terminal') then
    raise exception 'moyen_invalide';
  end if;
  insert into modifications_commande (commande_id, cle, reglement, lignes, ajouts, retires, adresse, details_livraison, zone_numero, moyen_remboursement, pizzas_seulement,
    sous_total_centimes, frais_centimes, total_centimes, tva_centimes, ancienne_valeur_centimes, difference_centimes, personnel_id, personnel_nom)
  values (c.id, p ->> 'cle', reg, p -> 'lignes', coalesce(p -> 'ajouts', '[]'::jsonb), coalesce(p -> 'retires', '[]'::jsonb),
    case when jsonb_typeof(p -> 'adresse') = 'object' then p -> 'adresse' end,
    case when jsonb_typeof(p -> 'details_livraison') = 'object' then p -> 'details_livraison' end,
    (p ->> 'zone_numero')::integer, p ->> 'moyen_remboursement', coalesce((p ->> 'pizzas_seulement')::boolean, false),
    (p ->> 'sous_total_centimes')::integer, (p ->> 'frais_centimes')::integer, (p ->> 'total_centimes')::integer,
    (p ->> 'tva_centimes')::integer, valeur, diff, p_personnel, nom)
  returning * into m;
  if reg = 'lien' then
    return to_jsonb(m) || jsonb_build_object('deja', false, 'applique', false);
  end if;
  return to_jsonb(m) || jsonb_build_object('deja', false) || appliquer_modification(m.id);
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
        delete from complements where id = x.id;
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

create or replace function demander_remboursement(p_commande uuid, p_montant integer, p_motif text, p_cle text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  -- Gérant, ou responsable de service au rôle ouvert (D1, droit « rembourser »).
  auteur text := auteur_droit(p_personnel, 'rembourser');
  m text := btrim(regexp_replace(coalesce(p_motif, ''), '\s+', ' ', 'g'));
  c commandes%rowtype;
  r remboursements%rowtype;
  engage integer;
begin
  if p_cle is null or length(p_cle) not between 8 and 80 then
    raise exception 'cle_invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('remboursement:' || p_cle));
  select * into r from remboursements where cle = p_cle;
  if found then
    if r.commande_id <> p_commande or r.montant_centimes <> p_montant then
      raise exception 'cle_reutilisee';
    end if;
    return to_jsonb(r) || jsonb_build_object('deja', true, 'numero', (select numero from commandes where id = p_commande));
  end if;
  if length(m) not between 3 and 200 then
    raise exception 'motif_invalide';
  end if;
  if p_montant is null or p_montant <= 0 then
    raise exception 'montant_invalide';
  end if;
  select * into c from commandes where id = p_commande for update;
  if not found then
    raise exception 'commande_inconnue';
  end if;
  if c.statut not in ('prete', 'partie', 'terminee') then
    raise exception 'statut_non_remboursable';
  end if;
  if c.statut_paiement not in ('paye', 'encaisse') then
    raise exception 'pas_encaissee';
  end if;
  if c.moyen_paiement = 'en_ligne' and c.stripe_payment_intent is null then
    raise exception 'sans_paiement_en_ligne';
  end if;
  select coalesce(sum(montant_centimes), 0) into engage from remboursements where commande_id = p_commande and statut in ('en_cours', 'fait');
  if engage + p_montant > c.total_centimes then
    raise exception 'montant_trop_eleve';
  end if;
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_id, personnel_nom, fait_le)
  values (p_commande, p_cle, p_montant, m,
    -- Rendu par le moyen qui a encaissé (décision du chef du 15.11.2026) : carte au comptoir ou à la porte, terminal.
    case when c.moyen_paiement = 'en_ligne' then 'stripe' when c.moyen_comptoir = 'carte' then 'terminal' else 'especes' end,
    case when c.moyen_paiement = 'en_ligne' then 'en_cours' else 'fait' end,
    p_personnel, auteur,
    case when c.moyen_paiement = 'en_ligne' then null else now() end)
  returning * into r;
  insert into evenements_commande (commande_id, de, vers, par, detail)
  values (p_commande, null, 'remboursement', 'gestion:' || auteur, (p_montant / 100.0)::numeric(10, 2)::text || ' CHF, ' || m);
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'remboursement', c.numero::text, null,
    jsonb_build_object('commande', c.id, 'jour', c.jour_service, 'montant_centimes', p_montant, 'motif', m, 'moyen', r.moyen));
  if r.statut = 'fait' then
    perform maj_rembourse(p_commande);
  end if;
  return to_jsonb(r) || jsonb_build_object('deja', false, 'numero', c.numero);
end;
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
  ),
  -- Rendu sur le terminal de carte (payé par carte au comptoir ou à la porte, 20261216140000).
  terminal_rendu as (
    select coalesce(sum(montant_centimes), 0)::bigint as montant from rembs where moyen = 'terminal' and statut = 'fait'
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
          + (select coalesce(sum(montant_centimes), 0) from complements_jour where moyen = 'en_ligne' and statut = 'encaisse' and statut_commande <> 'refusee'))
        from jour where moyen_paiement = 'en_ligne' and statut <> 'refusee' and statut_paiement in ('paye', 'rembourse')
      ),
      'complements', jsonb_build_object(
        'en_ligne_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where moyen = 'en_ligne' and statut = 'encaisse' and statut_commande <> 'refusee'),
        'especes_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement = 'especes'),
        'carte_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'encaisse' and moyen_encaissement = 'carte'),
        'a_encaisser_centimes', (select coalesce(sum(montant_centimes), 0) from complements_jour where statut = 'a_encaisser')
      ),
      'comptoir', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir),
      'deductions_centimes', (select coalesce(sum(montant), 0) from deductions),
      'especes_rendues_centimes', (select montant from especes_rendues),
      'terminal_rendu_centimes', (select montant from terminal_rendu),
      'attendu_comptoir_centimes', (select coalesce(sum(encaisse), 0) from comptoir) - (select montant from especes_rendues)
        - (select montant from terminal_rendu)
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
        - (select montant from terminal_rendu)
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
      round(o.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva_frais, false as complement
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
      k.montant_centimes as total_centimes, k.tva_centimes, k.frais_centimes,
      round(k.frais_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva_frais, true as complement
    from complements k join commandes o on o.id = k.commande_id
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, o.taux_tva_pourcent as taux,
      case when r.moyen = 'stripe' then 'stripe' when r.moyen = 'especes' then 'caisse' when r.moyen = 'terminal' then 'terminal'
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
    select jour, taux, 'vente' as sorte, moyen, count(*) filter (where not complement) as nombre, sum(total_centimes) as ttc, sum(tva_centimes) as tva,
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

create or replace function export_recap_jours(p_debut date, p_fin date) returns jsonb
language sql stable as $$
  with ventes as (
    select o.jour, o.taux_tva_pourcent as taux, o.moyen_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes, false as complement
    from commandes o
    where o.jour between p_debut and p_fin
      and o.statut_paiement in ('paye', 'encaisse', 'rembourse')
      and o.statut not in ('refusee', 'annulee')
    union all
    -- Compléments encaissés des commandes modifiées (vague 3, bo-commandes) : au jour de la commande, lien en ligne,
    -- porte ou comptoir au comptoir. Pas une vente de plus dans le compte des commandes.
    select o.jour, o.taux_tva_pourcent, case when k.moyen = 'en_ligne' then 'en_ligne' else 'comptoir' end, k.montant_centimes,
      k.tva_centimes, k.frais_centimes, true
    from complements k join commandes o on o.id = k.commande_id
    where o.jour between p_debut and p_fin and k.statut = 'encaisse' and o.statut not in ('refusee', 'annulee')
  ),
  rembs as (
    select (r.fait_le at time zone 'Europe/Zurich')::date as jour, o.taux_tva_pourcent as taux, r.moyen, r.montant_centimes,
      round(r.montant_centimes * o.taux_tva_pourcent / (100 + o.taux_tva_pourcent))::integer as tva
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= (p_debut::timestamp at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1)::timestamp at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
  ),
  lignes as (
    select jour, taux,
      count(*) filter (where not complement) as ventes, sum(total_centimes) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      sum(total_centimes) filter (where moyen_paiement = 'comptoir') as comptoir, sum(frais_centimes) as frais,
      sum(total_centimes) as ttc, sum(tva_centimes) as tva,
      0 as remb_stripe, 0 as remb_especes, 0 as remb_deduction, 0 as tva_remb, 0 as remb_terminal
    from ventes group by jour, taux
    union all
    select jour, taux, 0, 0, 0, 0, 0, 0,
      sum(montant_centimes) filter (where moyen = 'stripe'), sum(montant_centimes) filter (where moyen = 'especes'),
      sum(montant_centimes) filter (where moyen = 'deduction'), sum(tva), sum(montant_centimes) filter (where moyen = 'terminal')
    from rembs group by jour, taux
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jour', x.jour, 'taux_tva_pourcent', x.taux, 'ventes', x.ventes,
    'en_ligne_centimes', x.en_ligne, 'comptoir_centimes', x.comptoir, 'frais_centimes', x.frais, 'ttc_centimes', x.ttc,
    'tva_centimes', x.tva,
    'rembourse_en_ligne_centimes', x.remb_stripe, 'rembourse_especes_centimes', x.remb_especes,
    'deduit_centimes', x.remb_deduction, 'tva_remboursee_centimes', x.tva_remb, 'rembourse_terminal_centimes', x.remb_terminal,
    'net_ttc_centimes', x.ttc - x.remb_stripe - x.remb_especes - x.remb_deduction - x.remb_terminal,
    'net_tva_centimes', x.tva - x.tva_remb,
    'net_ht_centimes', (x.ttc - x.remb_stripe - x.remb_especes - x.remb_deduction - x.remb_terminal) - (x.tva - x.tva_remb)
  ) order by x.jour, x.taux), '[]'::jsonb)
  from (
    select jour, taux,
      sum(ventes)::bigint as ventes, coalesce(sum(en_ligne), 0)::bigint as en_ligne, coalesce(sum(comptoir), 0)::bigint as comptoir,
      coalesce(sum(frais), 0)::bigint as frais, coalesce(sum(ttc), 0)::bigint as ttc, coalesce(sum(tva), 0)::bigint as tva,
      coalesce(sum(remb_stripe), 0)::bigint as remb_stripe, coalesce(sum(remb_especes), 0)::bigint as remb_especes,
      coalesce(sum(remb_deduction), 0)::bigint as remb_deduction, coalesce(sum(tva_remb), 0)::bigint as tva_remb,
      coalesce(sum(remb_terminal), 0)::bigint as remb_terminal
    from lignes group by jour, taux
  ) x;
$$;

create or replace function pilotage_synthese(p_debut date, p_fin date, p_service text default null) returns jsonb
language sql stable as $$
  with prises as (
    select o.mode, o.moyen_paiement, o.statut_paiement, o.total_centimes, o.tva_centimes, o.frais_centimes, o.taux_tva_pourcent
    from commandes o
    where o.jour_service between p_debut and p_fin
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  -- Compléments des commandes modifiées (vague 3, bo-commandes), au jour de service de la commande : dans les ventes
  -- (encaissés ou à encaisser, comme les commandes), pas dans le compte des commandes.
  compl as (
    select k.montant_centimes, k.tva_centimes, k.frais_centimes, k.statut, k.moyen, o.mode, o.taux_tva_pourcent
    from complements k join commandes o on o.id = k.commande_id
    where o.jour_service between p_debut and p_fin
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  -- Refus du restaurant seulement : une annulation par le client (annulee_par_client_le) n'est pas un refus.
  refusees as (
    select o.total_centimes, coalesce(nullif(btrim(o.motif), ''), 'Sans motif') as motif
    from commandes o
    where o.jour_service between p_debut and p_fin and o.statut = 'refusee' and o.annulee_par_client_le is null
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  annulees_client as (
    select o.total_centimes
    from commandes o
    where o.jour_service between p_debut and p_fin and o.statut = 'refusee' and o.annulee_par_client_le is not null
      and (p_service is null or pilotage_service_de(o) = p_service)
  ),
  faits as (
    select r.montant_centimes, r.moyen, o.taux_tva_pourcent
    from remboursements r join commandes o on o.id = r.commande_id
    where r.statut = 'fait'
      and r.fait_le >= ((p_debut + time '05:00') at time zone 'Europe/Zurich')
      and r.fait_le < ((p_fin + 1 + time '05:00') at time zone 'Europe/Zurich')
      and o.statut not in ('refusee', 'annulee')
      and (p_service is null or pilotage_service_heure(r.fait_le) = p_service)
  ),
  ouverts as (
    select r.statut, r.montant_centimes
    from remboursements r
    where r.statut in ('en_cours', 'echec')
      and r.cree_le >= ((p_debut + time '05:00') at time zone 'Europe/Zurich')
      and r.cree_le < ((p_fin + 1 + time '05:00') at time zone 'Europe/Zurich')
      and (p_service is null or pilotage_service_heure(r.cree_le) = p_service)
  ),
  taux as (
    select t.taux, sum(t.ttc)::bigint as ttc, sum(t.tva)::bigint as tva, sum(t.rembourse)::bigint as rembourse, sum(t.tva_rembourse)::bigint as tva_rembourse
    from (
      select taux_tva_pourcent as taux, total_centimes as ttc, tva_centimes as tva, 0 as rembourse, 0 as tva_rembourse from prises
      union all
      select taux_tva_pourcent, montant_centimes, tva_centimes, 0, 0 from compl
      union all
      select taux_tva_pourcent, 0, 0, montant_centimes,
        round(montant_centimes * taux_tva_pourcent / (100 + taux_tva_pourcent))::integer from faits
    ) t
    group by t.taux
  )
  select jsonb_build_object(
    'commandes', p.commandes,
    'ttc_centimes', p.ttc,
    'tva_centimes', p.tva,
    'ht_centimes', p.ttc - p.tva,
    'panier_moyen_centimes', case when p.commandes > 0 then round(p.ttc::numeric / p.commandes)::bigint else 0 end,
    'encaisse_centimes', p.encaisse,
    'a_encaisser', p.a_encaisser,
    'a_encaisser_centimes', p.a_encaisser_ttc,
    'frais_centimes', p.frais,
    'livraison', jsonb_build_object('commandes', p.livraisons, 'ttc_centimes', p.livraison_ttc),
    'retrait', jsonb_build_object('commandes', p.commandes - p.livraisons, 'ttc_centimes', p.ttc - p.livraison_ttc),
    'en_ligne', jsonb_build_object('commandes', p.en_ligne, 'ttc_centimes', p.en_ligne_ttc),
    'comptoir', jsonb_build_object('commandes', p.commandes - p.en_ligne, 'ttc_centimes', p.ttc - p.en_ligne_ttc),
    'refusees', jsonb_build_object(
      'commandes', (select count(*) from refusees),
      'ttc_centimes', (select coalesce(sum(total_centimes), 0) from refusees),
      'motifs', coalesce((
        select jsonb_agg(jsonb_build_object('motif', m.motif, 'commandes', m.n, 'ttc_centimes', m.ttc) order by m.n desc, m.motif)
        from (select min(motif) as motif, count(*) as n, sum(total_centimes) as ttc from refusees group by lower(motif) order by count(*) desc, min(motif) limit 8) m
      ), '[]'::jsonb)
    ),
    'remboursements', (
      select jsonb_build_object(
        'faits', (select count(*) from faits),
        'faits_centimes', (select coalesce(sum(montant_centimes), 0) from faits),
        'faits_en_ligne_centimes', (select coalesce(sum(montant_centimes) filter (where moyen = 'stripe'), 0) from faits),
        'faits_especes_centimes', (select coalesce(sum(montant_centimes) filter (where moyen = 'especes'), 0) from faits),
        'faits_terminal_centimes', (select coalesce(sum(montant_centimes) filter (where moyen = 'terminal'), 0) from faits),
        'en_cours', count(*) filter (where statut = 'en_cours'),
        'en_cours_centimes', coalesce(sum(montant_centimes) filter (where statut = 'en_cours'), 0),
        'echecs', count(*) filter (where statut = 'echec'),
        'echecs_centimes', coalesce(sum(montant_centimes) filter (where statut = 'echec'), 0),
        -- Tous les échecs encore ouverts, quel que soit leur jour : l'argent dû au client ne sort pas du tableau.
        'echecs_ouverts', (select count(*) from remboursements where statut = 'echec'),
        'echecs_ouverts_centimes', (select coalesce(sum(montant_centimes), 0) from remboursements where statut = 'echec')
      )
      from ouverts
    ),
    'annulees_client', jsonb_build_object(
      'commandes', (select count(*) from annulees_client),
      'ttc_centimes', (select coalesce(sum(total_centimes), 0) from annulees_client)
    ),
    'net_ttc_centimes', p.ttc - (select coalesce(sum(montant_centimes), 0) from faits),
    'tva', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taux_pourcent', t.taux, 'ttc_centimes', t.ttc, 'tva_centimes', t.tva, 'ht_centimes', t.ttc - t.tva,
        'rembourse_centimes', t.rembourse, 'tva_remboursee_centimes', t.tva_rembourse,
        'net_ttc_centimes', t.ttc - t.rembourse, 'net_tva_centimes', t.tva - t.tva_rembourse,
        'net_ht_centimes', (t.ttc - t.rembourse) - (t.tva - t.tva_rembourse)
      ) order by t.taux)
      from taux t
    ), '[]'::jsonb)
  )
  from (
    select
      count(*) as commandes,
      coalesce(sum(total_centimes), 0)::bigint + (select coalesce(sum(montant_centimes), 0) from compl)::bigint as ttc,
      coalesce(sum(tva_centimes), 0)::bigint + (select coalesce(sum(tva_centimes), 0) from compl)::bigint as tva,
      coalesce(sum(total_centimes) filter (where statut_paiement in ('paye', 'encaisse', 'rembourse')), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where statut = 'encaisse'), 0) from compl)::bigint as encaisse,
      count(*) filter (where statut_paiement = 'a_encaisser_retrait') as a_encaisser,
      coalesce(sum(total_centimes) filter (where statut_paiement = 'a_encaisser_retrait'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where statut = 'a_encaisser'), 0) from compl)::bigint as a_encaisser_ttc,
      coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0)::bigint
        + (select coalesce(sum(frais_centimes) filter (where mode = 'livraison'), 0) from compl)::bigint as frais,
      count(*) filter (where mode = 'livraison') as livraisons,
      coalesce(sum(total_centimes) filter (where mode = 'livraison'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where mode = 'livraison'), 0) from compl)::bigint as livraison_ttc,
      count(*) filter (where moyen_paiement = 'en_ligne') as en_ligne,
      coalesce(sum(total_centimes) filter (where moyen_paiement = 'en_ligne'), 0)::bigint
        + (select coalesce(sum(montant_centimes) filter (where moyen = 'en_ligne'), 0) from compl)::bigint as en_ligne_ttc
    from prises
  ) p;
$$;

-- Commande remboursée seulement quand tout ce qui a été payé est rendu : le paiement de départ et les compléments
-- encaissés (un remboursement sur un complément ne marque plus la commande remboursée alors que des plats restent payés).
-- Recréée depuis 20261114090000.
create or replace function maj_rembourse(p_commande uuid) returns void
language sql as $$
  update commandes c set statut_paiement = 'rembourse', rembourse_le = now()
  where c.id = p_commande and c.statut_paiement in ('paye', 'encaisse')
    and (select coalesce(sum(r.montant_centimes), 0) from remboursements r where r.commande_id = c.id and r.statut = 'fait')
      >= c.total_centimes + (select coalesce(sum(k.montant_centimes), 0) from complements k where k.commande_id = c.id and k.statut = 'encaisse');
$$;
