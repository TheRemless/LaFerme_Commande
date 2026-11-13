-- Vague 3, qualite : un client a payé en ligne, mais la confirmation de Stripe n'est jamais arrivée (webhook
-- perdu, secret du webhook faux après un redéploiement, site tombé à ce moment) et le client a fermé la page
-- avant son retour sur le suivi. La commande restait « paiement en attente » : invisible pour la cuisine,
-- alors que l'argent était pris. La surveillance (chaque minute) relit chez Stripe la session de ces
-- commandes, entre 3 minutes (le temps normal du paiement) et 2 heures après leur création.
create function paiements_a_rattraper() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.id order by x.cree_le), '[]'::jsonb)
  from (
    select id, cree_le from commandes
    where statut = 'paiement_en_attente' and statut_paiement = 'en_attente' and stripe_session_id is not null
      and cree_le < now() - interval '3 minutes' and cree_le > now() - interval '2 hours'
    order by cree_le
    limit 20
  ) x;
$$;

revoke execute on function paiements_a_rattraper() from public, anon, authenticated;
grant execute on function paiements_a_rattraper() to service_role;
