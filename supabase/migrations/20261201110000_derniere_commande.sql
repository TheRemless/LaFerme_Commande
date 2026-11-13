-- Vague 3, client-commande : la dernière commande d'un client connecté, proposée dès l'accueil
-- (« Reprendre cette commande »). Fonction neuve, aucun objet existant recréé. Lecture seule, réservée au
-- serveur (service_role), qui ne l'appelle qu'avec le compte de la session.

create function derniere_commande_compte(p_compte uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', o.id,
    'cree_le', o.cree_le,
    'mode', o.mode,
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte) order by l.position)
      from commande_lignes l where l.commande_id = o.id
    ), '[]'::jsonb)
  )
  from commandes o
  where o.compte_id = p_compte and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
  order by o.cree_le desc
  limit 1;
$$;

revoke execute on function derniere_commande_compte(uuid) from public, anon, authenticated;
grant execute on function derniere_commande_compte(uuid) to service_role;
