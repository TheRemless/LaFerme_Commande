-- Vague 3, bo-commandes : rôle « responsable de service » (D1, oui de Jérémy le 13.11.2026), part des commandes.
-- Le responsable rembourse après coup (droit « rembourser »), jusqu'au montant de la commande comme le gérant.
-- Sans le réglage role_responsable_actif à true, rien ne change : auteur_droit ne laisse passer que le gérant.
--
-- Objet recréé : demander_remboursement, depuis sa seule définition dans main (20261114090000_correctifs_gerant.sql).
-- Seul changement : gerant_nom(p_personnel) devient auteur_droit(p_personnel, 'rembourser'). Même signature, droits
-- gardés (create or replace). modifier_commande et annuler_commande_partie passent par la #232 de tablette
-- (20261213220000), pas ici. Numéro réservé par le chef (plage de bo-commandes).

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
    case when c.moyen_paiement = 'en_ligne' then 'stripe' else 'especes' end,
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
