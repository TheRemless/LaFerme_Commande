-- Vague 3, bo-commandes : annulation après une baisse (relecture de qualite sur #257, demande du chef du 15.11.2026).
-- Après une baisse qui a vidé le paiement de départ, l'annulation demandait à Stripe un remboursement complet de ce
-- paiement : le vrai Stripe répond charge_already_refunded, et le reste du complément payé par le lien n'était
-- jamais rendu. Le serveur demande désormais à Stripe ce qui reste du départ seulement (rien s'il ne reste rien),
-- puis rend toujours les compléments.
--
-- Nouveaux objets :
--   reste_paiement_depart(commande) : le total payé au départ moins ses remboursements faits ou en cours (ceux sur un
--     complément exclus) ;
--   remboursements_doublure et rembourser_doublure(...) : la doublure de Stripe tient le compte de ce qu'elle a rendu
--     sur chaque paiement et refuse comme Stripe un remboursement au-delà (charge_already_refunded, amount_too_large).
--     Écrite seulement sans clé Stripe (préversions sur une base de test, tests) ; jamais lue par l'application.
-- Objet recréé depuis sa dernière définition :
--   noter_remboursement_refus (20261125090000) : ce qui restait à rendre sur le paiement de départ seulement.
-- Numéro donné par le chef.

create or replace function reste_paiement_depart(p_commande uuid) returns integer
language sql stable as $$
  select greatest(c.total_centimes - coalesce((select sum(r.montant_centimes) from remboursements r
    where r.commande_id = c.id and r.statut in ('fait', 'en_cours') and r.payment_intent_cible is null and r.complement_id is null), 0), 0)::integer
  from commandes c where c.id = p_commande;
$$;

create or replace function noter_remboursement_refus(p_commande uuid, p_refund_id text, p_fait boolean, p_motif text) returns void
language sql as $$
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, stripe_refund_id, personnel_nom, fait_le)
  -- Ce qui restait à rendre sur le paiement de départ : manques et baisses déjà rendus déduits, pas ceux d'un complément
  -- (rendus sur leur propre paiement).
  select c.id, 'refus-' || c.id, reste_paiement_depart(c.id),
    left(case when length(btrim(coalesce(p_motif, ''))) >= 3 then btrim(p_motif) else 'Commande refusée.' end, 200),
    'stripe', case when p_fait then 'fait' else 'en_cours' end, p_refund_id, 'tablette',
    case when p_fait then now() end
  from commandes c
  where c.id = p_commande and reste_paiement_depart(c.id) > 0
  on conflict (cle) do nothing;
$$;

create table remboursements_doublure (
  cle text primary key,
  payment_intent text not null,
  montant_centimes integer,
  cree_le timestamptz not null default now()
);
alter table remboursements_doublure enable row level security;
revoke all on remboursements_doublure from anon, authenticated;
grant select, insert on remboursements_doublure to service_role;

-- Comme Stripe : une même clé rend le même remboursement ; sans montant, tout ce qui reste ; rien au-delà de ce qui
-- a été payé. Le montant payé est celui de la commande ou du complément qui porte ce paiement, quand un seul le porte
-- (sinon, paiement d'essai sans montant connu : pas de plafond).
create or replace function rembourser_doublure(p_payment_intent text, p_montant integer, p_cle text) returns jsonb
language plpgsql as $$
declare
  d remboursements_doublure%rowtype;
  paye integer;
  rendu integer;
  montant integer := p_montant;
begin
  perform pg_advisory_xact_lock(hashtext('doublure:' || p_payment_intent));
  select * into d from remboursements_doublure where cle = p_cle;
  if found then
    return jsonb_build_object('id', 're_doublure_' || p_cle, 'montant_centimes', d.montant_centimes);
  end if;
  if (select count(*) from commandes where stripe_payment_intent = p_payment_intent) = 1
     and not exists (select 1 from complements where stripe_payment_intent = p_payment_intent) then
    select total_centimes into paye from commandes where stripe_payment_intent = p_payment_intent;
  elsif (select count(*) from complements where stripe_payment_intent = p_payment_intent) = 1
     and not exists (select 1 from commandes where stripe_payment_intent = p_payment_intent) then
    select montant_centimes into paye from complements where stripe_payment_intent = p_payment_intent;
  end if;
  if paye is not null then
    select coalesce(sum(montant_centimes), 0) into rendu from remboursements_doublure where payment_intent = p_payment_intent;
    if rendu >= paye then
      raise exception 'charge_already_refunded';
    end if;
    montant := coalesce(p_montant, paye - rendu);
    if montant > paye - rendu then
      raise exception 'amount_too_large';
    end if;
  end if;
  insert into remboursements_doublure (cle, payment_intent, montant_centimes) values (p_cle, p_payment_intent, montant);
  return jsonb_build_object('id', 're_doublure_' || p_cle, 'montant_centimes', montant);
end;
$$;

revoke execute on function reste_paiement_depart(uuid), rembourser_doublure(text, integer, text) from public, anon, authenticated;
grant execute on function reste_paiement_depart(uuid), rembourser_doublure(text, integer, text) to service_role;
