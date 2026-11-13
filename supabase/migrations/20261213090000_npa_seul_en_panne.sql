-- Vague 3, client-commande : décision C15 de Jérémy (13.11.2026). Quand le registre fédéral des adresses ne
-- répond pas, une adresse de livraison est acceptée sur son seul NPA, pendant la panne seulement, au prix de la
-- zone la plus chère de ce NPA (src/lib/zone-serveur.ts). Elle est enregistrée « non vérifiée » avec la
-- commande, et la tablette en avertit l'équipe, qui contrôle la rue avant d'accepter (src/lib/commandes.ts).
-- Allumé : c'est la décision. Le gérant peut l'éteindre au back-office (Réglages généraux) ; éteint, le client
-- lit le message de panne (à emporter ou téléphone), comme avant.
--
-- Objet recréé (le mien) : options_commande, repris de 20261210210000_couverts_prenoms.sql, avec la clé neuve.
-- Ajout sur une table partagée : une ligne dans interrupteurs_gestion (prévue pour ça, bo-operations).

insert into reglages (cle, valeur, proposition) values ('npa_seul_en_panne_actif', 'true', false)
  on conflict (cle) do nothing;

insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('npa_seul_en_panne_actif', 'Registre des adresses en panne : accepter une adresse sur son NPA',
    'C15 : au prix de la zone la plus chère de ce NPA. La tablette avertit « adresse non vérifiée » : contrôlez la rue avant d''accepter.', 'aucun', 60)
  on conflict (cle) do nothing;

create or replace function options_commande() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'couverts_actifs', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'couverts_actifs'), false),
    'prenom_par_ligne_actif', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'prenom_par_ligne_actif'), false),
    'npa_seul_en_panne_actif', coalesce((select valeur = 'true'::jsonb from reglages where cle = 'npa_seul_en_panne_actif'), false)
  );
$$;

revoke execute on function options_commande() from public, anon, authenticated;
grant execute on function options_commande() to service_role;
