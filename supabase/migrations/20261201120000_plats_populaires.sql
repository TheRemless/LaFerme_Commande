-- Vague 3, client-commande : plats les plus commandés (décision C7 de Jérémy) et une seule suggestion au panier
-- (boisson ou dessert, P2 du carnet). Construits complets mais DÉSACTIVÉS : deux réglages à false, que le gérant
-- active quand Jérémy l'aura décidé (C7 recommande d'attendre quatre semaines de vraies commandes).
-- Rien n'est choisi à la main ni inventé : seules les ventes des 28 derniers jours comptent.
-- Fonction neuve, aucun objet existant recréé.

insert into reglages (cle, valeur, proposition) values
  ('plats_populaires_actifs', 'false', true),
  ('suggestion_panier_active', 'false', true)
on conflict (cle) do nothing;

-- { populaires_actifs, suggestion_active, tous: [6 slugs au plus], par_categorie: { categorie: [slugs] } }.
-- Rien n'est calculé tant que les deux réglages sont éteints.
create function plats_populaires() returns jsonb
language sql stable as $$
  with drapeaux as (
    select
      coalesce((select valeur = 'true'::jsonb from reglages where cle = 'plats_populaires_actifs'), false) as populaires,
      coalesce((select valeur = 'true'::jsonb from reglages where cle = 'suggestion_panier_active'), false) as suggestion
  ),
  ventes as (
    select l.plat_slug as slug, sum(l.qte)::integer as qte
    from commandes o
    join commande_lignes l on l.commande_id = o.id
    where ((select populaires from drapeaux) or (select suggestion from drapeaux))
      and o.jour_service >= (now() at time zone 'Europe/Zurich')::date - 28
      and o.statut not in ('paiement_en_attente', 'annulee', 'refusee')
    group by l.plat_slug
  ),
  classement as (
    select v.slug, v.qte, c.slug as categorie
    from ventes v
    join plats p on p.slug = v.slug and p.commandable
    join categories c on c.id = p.categorie_id
  )
  select jsonb_build_object(
    'populaires_actifs', (select populaires from drapeaux),
    'suggestion_active', (select suggestion from drapeaux),
    'tous', coalesce((select jsonb_agg(t.slug order by t.qte desc, t.slug) from (select slug, qte from classement order by qte desc, slug limit 6) t), '[]'::jsonb),
    'par_categorie', coalesce((
      select jsonb_object_agg(x.categorie, x.slugs)
      from (select categorie, jsonb_agg(slug order by qte desc, slug) as slugs from classement group by categorie) x
    ), '{}'::jsonb)
  );
$$;

revoke execute on function plats_populaires() from public, anon, authenticated;
grant execute on function plats_populaires() to service_role;
