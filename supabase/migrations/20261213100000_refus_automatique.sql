-- Vague 3, client-commande : décision C13 de Jérémy (13.11.2026). Une commande « dès que possible » que personne
-- n'accepte dans le délai (refus_automatique_minutes, 15) est refusée par la surveillance comme sur la tablette :
-- remboursée si elle est payée en ligne, e-mail au client, pause des commandes en ligne et alerte au gérant
-- (src/lib/refus-automatique.ts). Seulement pendant un service, jamais pour une commande à une heure choisie.
-- Allumé : c'est la décision. Le gérant peut l'éteindre au back-office (Réglages généraux).
--
-- Objet neuf : commandes_sans_reponse. Ajouts sur des tables partagées : deux réglages et une ligne dans
-- interrupteurs_gestion (prévue pour ça, bo-operations).

insert into reglages (cle, valeur, proposition) values
  ('refus_automatique_actif', 'true', false),
  ('refus_automatique_minutes', '15', false)
  on conflict (cle) do nothing;

insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('refus_automatique_actif', 'Refuser et rembourser une commande que personne n''accepte',
    'C13 : après 15 minutes sans acceptation, pendant un service, commandes « dès que possible » seulement. Le client est prévenu par e-mail, les commandes en ligne passent en pause et le gérant reçoit une alerte.', 'aucun', 70)
  on conflict (cle) do nothing;

-- Commandes visibles sur la tablette (payées en ligne, ou à payer au comptoir), toujours nouvelles après le délai,
-- compté depuis le paiement : la page de paiement de Stripe ne fait pas courir le délai.
create function commandes_sans_reponse() returns jsonb
language sql stable as $$
  with r as (
    select
      coalesce((select valeur = 'true'::jsonb from reglages where cle = 'refus_automatique_actif'), false) as actif,
      greatest(coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'refus_automatique_minutes'), 15), 5) as minutes
  )
  select jsonb_build_object(
    'minutes', r.minutes,
    'commandes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero) order by c.numero)
      from commandes c
      where r.actif
        and c.statut = 'nouvelle'
        and c.quand_type = 'asap'
        and c.statut_paiement in ('paye', 'a_encaisser_retrait')
        and coalesce(c.paye_le, c.cree_le) < now() - make_interval(mins => r.minutes)
    ), '[]'::jsonb)
  )
  from r;
$$;

revoke execute on function commandes_sans_reponse() from public, anon, authenticated;
grant execute on function commandes_sans_reponse() to service_role;
