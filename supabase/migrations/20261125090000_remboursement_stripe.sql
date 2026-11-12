-- Audit de sécurité 2, S2-03 : un remboursement Stripe n'est « fait » que quand Stripe dit « succeeded ».
-- Stripe peut accepter une demande (« pending ») puis l'abandonner (« failed »), surtout avec TWINT : la ligne
-- reste alors « en cours », hors de l'export de la fiduciaire, jusqu'à l'événement charge.refund.updated.
-- Le remboursement d'une commande refusée a désormais aussi sa ligne, pour être suivi de la même façon.
-- Aucun objet existant n'est recréé : trois fonctions neuves. Aucun UPDATE ni DELETE sur des données.

-- Ligne « en cours » partie chez Stripe, en attente de sa confirmation : on note l'identifiant du remboursement.
-- change = vrai la première fois seulement (le serveur prévient alors le client, comme avant).
create function noter_remboursement_stripe(p_id uuid, p_refund_id text) returns jsonb
language plpgsql as $$
declare
  r remboursements%rowtype;
begin
  update remboursements set stripe_refund_id = p_refund_id
  where id = p_id and statut = 'en_cours' and stripe_refund_id is null
  returning * into r;
  if found then
    return to_jsonb(r) || jsonb_build_object('change', true);
  end if;
  select * into r from remboursements where id = p_id;
  return to_jsonb(r) || jsonb_build_object('change', false);
end;
$$;

-- Remboursement entier d'une commande refusée (tablette) : une ligne, faite ou en cours selon Stripe.
-- Une seule par commande (clé « refus-<id> »). La commande refusée n'est jamais une vente : l'export de la
-- fiduciaire et les totaux du back-office l'ignorent déjà.
create function noter_remboursement_refus(p_commande uuid, p_refund_id text, p_fait boolean, p_motif text) returns void
language sql as $$
  insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, stripe_refund_id, personnel_nom, fait_le)
  -- Ce qui restait à rendre : Stripe rembourse « tout ce qui reste », manques déjà rendus déduits.
  select c.id, 'refus-' || c.id,
    c.total_centimes - coalesce((select sum(r.montant_centimes) from remboursements r where r.commande_id = c.id and r.statut in ('en_cours', 'fait')), 0)::integer,
    left(case when length(btrim(coalesce(p_motif, ''))) >= 3 then btrim(p_motif) else 'Commande refusée.' end, 200),
    'stripe', case when p_fait then 'fait' else 'en_cours' end, p_refund_id, 'tablette',
    case when p_fait then now() end
  from commandes c
  where c.id = p_commande
    and c.total_centimes > coalesce((select sum(r.montant_centimes) from remboursements r where r.commande_id = c.id and r.statut in ('en_cours', 'fait')), 0)
  on conflict (cle) do nothing;
$$;

-- Événement charge.refund.updated : état final d'un remboursement connu. « succeeded » ne change qu'une ligne
-- encore « en cours ». Un échec change aussi une ligne déjà « faite » : Stripe peut annoncer l'échec d'un
-- remboursement d'abord réussi ; elle sort alors de l'export. Un état reçu deux fois ne fait rien.
-- null : remboursement inconnu (fait à la main dans le tableau de bord Stripe, par exemple).
create function maj_remboursement_stripe(p_refund_id text, p_ok boolean, p_erreur text) returns jsonb
language plpgsql as $$
declare
  rid uuid;
begin
  select id into rid from remboursements where stripe_refund_id = p_refund_id;
  if rid is null then
    return null;
  end if;
  if p_ok then
    return terminer_remboursement(rid, true, p_refund_id, null)
      || (select jsonb_build_object('numero', o.numero) from remboursements r join commandes o on o.id = r.commande_id where r.id = rid);
  end if;
  update remboursements set statut = 'echec', erreur = left(p_erreur, 300), fait_le = null
  where id = rid and statut in ('en_cours', 'fait');
  return (select to_jsonb(r) || jsonb_build_object('change', found, 'numero', o.numero)
          from remboursements r join commandes o on o.id = r.commande_id where r.id = rid);
end;
$$;

create index remboursements_refund_idx on remboursements (stripe_refund_id) where stripe_refund_id is not null;

revoke execute on function
  noter_remboursement_stripe(uuid, text), noter_remboursement_refus(uuid, text, boolean, text), maj_remboursement_stripe(text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  noter_remboursement_stripe(uuid, text), noter_remboursement_refus(uuid, text, boolean, text), maj_remboursement_stripe(text, boolean, text)
  to service_role;
