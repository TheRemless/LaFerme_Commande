-- Vague 3, bo-socle : rubrique « Mise en route » du back-office (demande de Jérémy, 13.11.2026 : « paramétrer
-- pour lancer le service dans 10 minutes »). Une seule lecture rassemble l'état réel de chaque étape ; le serveur
-- y ajoute ce que la base ne sait pas (imprimantes en ligne, variables d'envoi et de paiement présentes).
-- Aucune donnée de client : seulement des nombres et des dates. Gérant seulement.
-- Pas d'objet partagé recréé : fonction neuve. Plage de bo-socle (20261213150000 à 20261213170000).

create function etat_mise_en_route(p_personnel uuid) returns jsonb
language plpgsql stable as $$
begin
  perform gerant_nom(p_personnel);
  return jsonb_build_object(
    -- Personnes de la tablette en plus du gérant (service ou responsable de service).
    'equipe', (select count(*) from personnel where actif and role in ('service', 'responsable')),
    -- Dernier signe de vie d'un appareil qui a touché « Démarrer le service » (surveillance de la tablette).
    'tablette_vue_le', (select tablette_vue_le from surveillance_etat),
    -- Imprimantes dont un ticket de test est sorti (tâche d'essai confirmée par l'imprimante).
    'imprimantes_testees', coalesce((
      select jsonb_agg(distinct t.imprimante_id) from taches_impression t
      where t.essai and t.etat = 'imprimee' and t.imprimante_id is not null), '[]'::jsonb),
    'zones_actives', (select count(*) from zones_livraison where active),
    'zones_a_valider', (select count(*) from zones_livraison where active and proposition),
    'horaires', (select count(*) from horaires),
    'horaires_a_valider', (select count(*) from horaires where proposition),
    'plats_bloquants', (select count(*) from plats_bloquants),
    'livreurs', (select count(*) from personnel where actif and role = 'livreur'),
    -- Livreurs qui se sont déjà connectés au moins une fois (sur /livreur).
    'livreurs_connectes', (select count(distinct p.id) from personnel p join sessions_personnel s on s.personnel_id = p.id
      where p.actif and p.role = 'livreur'),
    'courriels_envoyes', (select count(*) from envois_courriel where statut = 'envoye'),
    'evenements_paiement', (select count(*) from evenements_paiement),
    -- Une commande payée en ligne, puis remboursée (remboursement confirmé ou paiement rendu en entier).
    'essai_rembourse', exists (
      select 1 from commandes c where c.moyen_paiement = 'en_ligne'
        and (c.statut_paiement = 'rembourse' or exists (select 1 from remboursements r where r.commande_id = c.id and r.statut = 'fait')))
  );
end;
$$;

revoke all on function etat_mise_en_route(uuid) from public, anon, authenticated;
grant execute on function etat_mise_en_route(uuid) to service_role;
