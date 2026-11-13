-- Vague 3, client-compte : la page de suivi montre ce qui est rendu au client (manque, geste, refus), avec
-- l'état réel du remboursement (en cours chez Stripe, fait, échoué ; S2-03).
-- Ni le motif écrit par l'équipe, ni l'erreur de Stripe, ni l'auteur : seulement montant, moyen, état et dates.
-- Aucun objet existant n'est recréé. Aucun UPDATE ni DELETE.
create function suivi_remboursements(p_commande uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'montant_centimes', r.montant_centimes, 'moyen', r.moyen, 'statut', r.statut, 'cree_le', r.cree_le, 'fait_le', r.fait_le
  ) order by r.cree_le), '[]'::jsonb)
  from remboursements r where r.commande_id = p_commande;
$$;

revoke execute on function suivi_remboursements(uuid) from public, anon, authenticated;
grant execute on function suivi_remboursements(uuid) to service_role;
