-- Vague 3, client-compte : tout l'historique d'un compte, par pages (espace_compte n'en montre que 30), et le
-- nombre de commandes. Même forme de commande que espace_compte. Pagination par date (index
-- commandes_compte_idx : compte_id, cree_le desc). Fonction neuve ; aucun objet recréé, aucun UPDATE ni DELETE.
create function commandes_compte(p_compte uuid, p_avant timestamptz, p_limite integer) returns jsonb
language sql stable as $$
  with page as (
    select o.* from commandes o
    where o.compte_id = p_compte and o.statut not in ('paiement_en_attente', 'annulee')
      and (p_avant is null or o.cree_le < p_avant)
    order by o.cree_le desc
    limit least(greatest(coalesce(p_limite, 30), 0), 50) + 1
  ),
  rangees as (select *, row_number() over (order by cree_le desc) as rang from page)
  select jsonb_build_object(
    'commandes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'numero', r.numero, 'cree_le', r.cree_le, 'mode', r.mode, 'statut', r.statut,
        'total_centimes', r.total_centimes, 'jeton_suivi', r.jeton_suivi,
        'lignes', coalesce((
          select jsonb_agg(jsonb_build_object('nom', l.nom, 'qte', l.qte) order by l.position)
          from commande_lignes l where l.commande_id = r.id
        ), '[]'::jsonb)
      ) order by r.cree_le desc)
      from rangees r where r.rang <= least(greatest(coalesce(p_limite, 30), 0), 50)
    ), '[]'::jsonb),
    'suite', (select count(*) from page) > least(greatest(coalesce(p_limite, 30), 0), 50),
    'total', (select count(*) from commandes o where o.compte_id = p_compte and o.statut not in ('paiement_en_attente', 'annulee'))
  );
$$;
revoke execute on function commandes_compte(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function commandes_compte(uuid, timestamptz, integer) to service_role;
