-- Base embarquée seulement (développement et tests), jamais appliquée sur Supabase.
-- Un membre d'équipe par projet Playwright : la limite d'un code par 30 secondes est par e-mail.
-- equipe@laferme.test : gérant des essais, retiré de la vraie base (migration 20261112090000).
insert into personnel (email, nom, role) values
  ('equipe@laferme.test', 'Équipe test', 'gerant'),
  ('equipe-bureau@laferme.test', 'Test bureau', 'service'),
  ('equipe-mobile@laferme.test', 'Test mobile', 'service'),
  ('gerant-bureau@laferme.test', 'Gérant bureau', 'gerant'),
  ('gerant-mobile@laferme.test', 'Gérant mobile', 'gerant'),
  ('cuisine-bureau@laferme.test', 'Cuisine bureau', 'service'),
  ('cuisine-mobile@laferme.test', 'Cuisine mobile', 'service'),
  ('impression@laferme.test', 'Test impression', 'gerant'),
  ('a11y-bureau@laferme.test', 'Test accessibilité bureau', 'gerant'),
  ('a11y-mobile@laferme.test', 'Test accessibilité mobile', 'gerant'),
  -- Carte gérée au back-office (tests/e2e/gestion-carte.spec.ts) : comptes à part, un code par 30 s et par e-mail.
  ('carte-bureau@laferme.test', 'Carte bureau', 'gerant'),
  ('carte-mobile@laferme.test', 'Carte mobile', 'gerant'),
  -- Remboursements vus au suivi (tests/e2e/suivi.spec.ts) : comptes à part, un code par 30 s et par e-mail.
  ('suivi-bureau@laferme.test', 'Suivi bureau', 'gerant'),
  ('suivi-mobile@laferme.test', 'Suivi mobile', 'gerant'),
  -- Coque du back-office (vague 3, tests/e2e/gestion-coque.spec.ts).
  ('coque-bureau@laferme.test', 'Coque bureau', 'gerant'),
  ('coque-mobile@laferme.test', 'Coque mobile', 'gerant'),
  ('coque-service-bureau@laferme.test', 'Coque service bureau', 'service'),
  ('coque-service-mobile@laferme.test', 'Coque service mobile', 'service'),
  -- Kit du back-office (tests/e2e/gestion-kit.spec.ts, page /gestion/kit en local).
  ('kit-bureau@laferme.test', 'Kit bureau', 'gerant'),
  ('kit-mobile@laferme.test', 'Kit mobile', 'gerant'),
  -- Accueil du back-office (tests/e2e/gestion-accueil.spec.ts).
  ('accueil-bureau@laferme.test', 'Accueil bureau', 'gerant'),
  ('accueil-mobile@laferme.test', 'Accueil mobile', 'gerant'),
  ('accueil-service-bureau@laferme.test', 'Accueil service bureau', 'service'),
  ('accueil-service-mobile@laferme.test', 'Accueil service mobile', 'service'),
  -- Recherche globale du back-office (tests/e2e/gestion-recherche.spec.ts).
  ('recherche-bureau@laferme.test', 'Recherche bureau', 'gerant'),
  ('recherche-mobile@laferme.test', 'Recherche mobile', 'gerant'),
  -- Appareils de l'équipe (tests/e2e/gestion-appareils.spec.ts).
  ('appareils-bureau@laferme.test', 'Appareils bureau', 'gerant'),
  ('appareils-mobile@laferme.test', 'Appareils mobile', 'gerant'),
  ('appareils-service-bureau@laferme.test', 'Téléphone bureau', 'service'),
  ('appareils-service-mobile@laferme.test', 'Téléphone mobile', 'service');

-- Livreurs des essais (tests/e2e/livreurs.spec.ts) et la tablette qui leur donne les commandes.
insert into personnel (email, nom, role) values
  ('livraison@laferme.test', 'Test livraison', 'service'),
  ('marco@laferme.test', 'Marco', 'livreur'),
  ('ines@laferme.test', 'Inès', 'livreur'),
  -- Annuler une livraison partie : gérant seulement (audit de sécurité 2, S2-01), tests/e2e/livreurs.spec.ts.
  ('gerant-livraison@laferme.test', 'Gérant livraison', 'gerant');

-- Coup de feu (tests/e2e/coup-de-feu.spec.ts, vague 3) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('cdf-bureau@laferme.test', 'Coup de feu bureau', 'gerant'),
  ('cdf-mobile@laferme.test', 'Coup de feu mobile', 'gerant'),
  ('cdf-service-bureau@laferme.test', 'Service bureau', 'service'),
  ('cdf-service-mobile@laferme.test', 'Service mobile', 'service');

-- Zones par service et zone fermée (tests/e2e/zones-services.spec.ts, vague 3) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('zones-bureau@laferme.test', 'Zones bureau', 'gerant'),
  ('zones-mobile@laferme.test', 'Zones mobile', 'gerant');

-- Calendrier du back-office (tests/e2e/calendrier.spec.ts, vague 3).
insert into personnel (email, nom, role) values ('calendrier-bureau@laferme.test', 'Calendrier bureau', 'gerant');

-- Chiffres et journal (bo-pilotage, tests/e2e/gestion-journal.spec.ts, vague 3) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('pilotage-bureau@laferme.test', 'Pilotage bureau', 'gerant'),
  ('pilotage-mobile@laferme.test', 'Pilotage mobile', 'gerant');

-- Planning des livreurs (tests/e2e/planning-livreurs.spec.ts, vague 3) : un gérant et un livreur à part.
insert into personnel (email, nom, role) values
  ('planning-bureau@laferme.test', 'Planning bureau', 'gerant'),
  ('planning-livreur@laferme.test', 'Livreur planning', 'livreur');

-- Messages aux clients (tests/e2e/messages-clients.spec.ts, vague 3).
insert into personnel (email, nom, role) values ('messages-bureau@laferme.test', 'Messages bureau', 'gerant');

-- Réglages généraux (tests/e2e/reglages-generaux.spec.ts, vague 3).
insert into personnel (email, nom, role) values ('reglages-bureau@laferme.test', 'Réglages bureau', 'gerant');

-- Écran Livreurs du back-office (tests/e2e/gestion-livreurs.spec.ts, vague 3) : un gérant et deux livreurs à part.
insert into personnel (email, nom, role) values
  ('ecran-livreurs@laferme.test', 'Écran livreurs', 'gerant'),
  ('sami@laferme.test', 'Sami', 'livreur'),
  ('nora@laferme.test', 'Nora', 'livreur');

-- Écran Réglages généraux (tests/e2e/gestion-reglages.spec.ts, vague 3).
insert into personnel (email, nom, role) values ('ecran-reglages@laferme.test', 'Écran réglages', 'gerant');

-- Commandes et clients du back-office (vague 3, bo-commandes, tests/e2e/gestion-commandes.spec.ts).
insert into personnel (email, nom, role) values
  ('commandes-bureau@laferme.test', 'Commandes bureau', 'gerant'),
  ('commandes-mobile@laferme.test', 'Commandes mobile', 'gerant');

-- Comptes des tests de la carte au back-office (vague 3, bo-carte) : un bloc à part pour ne pas entrer en
-- conflit avec la liste commune. Un code par 30 secondes et par e-mail : un compte par fichier et par projet.
insert into personnel (email, nom, role) values
  ('liste-bureau@laferme.test', 'Liste bureau', 'gerant'),
  ('liste-mobile@laferme.test', 'Liste mobile', 'gerant'),
  ('groupes-bureau@laferme.test', 'Groupes bureau', 'gerant'),
  ('groupes-mobile@laferme.test', 'Groupes mobile', 'gerant'),
  ('promos-bureau@laferme.test', 'Promos bureau', 'gerant'),
  ('promos-mobile@laferme.test', 'Promos mobile', 'gerant'),
  ('menus-bureau@laferme.test', 'Menus bureau', 'gerant'),
  ('menus-mobile@laferme.test', 'Menus mobile', 'gerant');

-- Rubrique Clients du back-office (vague 3, bo-commandes, tests/e2e/gestion-clients.spec.ts).
insert into personnel (email, nom, role) values
  ('clients-bureau@laferme.test', 'Clients bureau', 'gerant'),
  ('clients-mobile@laferme.test', 'Clients mobile', 'gerant');

-- Écran Livraison et horaires, parties de la vague 3 (tests/e2e/gestion-service-v3.spec.ts).
insert into personnel (email, nom, role) values ('ecran-service@laferme.test', 'Écran service', 'gerant');

-- Rapports (bo-pilotage, tests/e2e/gestion-rapports.spec.ts, vague 3) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('rapports-bureau@laferme.test', 'Rapports bureau', 'gerant'),
  ('rapports-mobile@laferme.test', 'Rapports mobile', 'gerant');

-- Clôture du jour (bo-pilotage, tests/e2e/gestion-cloture.spec.ts, vague 3) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('cloture-bureau@laferme.test', 'Clôture bureau', 'gerant'),
  ('cloture-mobile@laferme.test', 'Clôture mobile', 'gerant');

-- bo-operations, écrans de la vague 3 : un compte par écran (gestion-calendrier, gestion-imprimantes et
-- gestion-messages.spec.ts). Bloc identique dans chacune de mes PR : elles fusionnent sans conflit entre elles.
insert into personnel (email, nom, role) values
  ('ecran-calendrier@laferme.test', 'Écran calendrier', 'gerant'),
  ('ecran-imprimantes@laferme.test', 'Écran imprimantes', 'gerant'),
  ('ecran-messages@laferme.test', 'Écran messages', 'gerant');

-- Bannière des messages aux clients sur le site (client-commande, messages-bandeau.spec.ts).
insert into personnel (email, nom, role) values ('bandeau-client@laferme.test', 'Bandeau client', 'gerant');

-- Responsable de service (D1, oui de Jérémy le 13.11.2026) : rôle activé dans la base embarquée, comme il le sera
-- en production quand le chef posera role_responsable_actif. Un compte par fichier de test et par projet
-- Playwright (un code par e-mail toutes les 30 secondes) : socle (bo-socle, gestion-responsable.spec.ts),
-- commandes (bo-commandes), tablette (tablette), operations (bo-operations).
insert into reglages (cle, valeur, proposition) values ('role_responsable_actif', 'true', false)
  on conflict (cle) do update set valeur = excluded.valeur, proposition = false;
insert into personnel (email, nom, role) values
  ('responsable-socle-bureau@laferme.test', 'Responsable socle bureau', 'responsable'),
  ('responsable-socle-mobile@laferme.test', 'Responsable socle mobile', 'responsable'),
  ('responsable-commandes-bureau@laferme.test', 'Responsable commandes bureau', 'responsable'),
  ('responsable-commandes-mobile@laferme.test', 'Responsable commandes mobile', 'responsable'),
  ('responsable-tablette-bureau@laferme.test', 'Responsable tablette bureau', 'responsable'),
  ('responsable-tablette-mobile@laferme.test', 'Responsable tablette mobile', 'responsable'),
  ('responsable-operations-bureau@laferme.test', 'Responsable operations bureau', 'responsable'),
  ('responsable-operations-mobile@laferme.test', 'Responsable operations mobile', 'responsable'),
  -- Employés dont le responsable coupe l'appareil (gestion-responsable.spec.ts).
  ('responsable-cible-bureau@laferme.test', 'Cible bureau', 'service'),
  ('responsable-cible-mobile@laferme.test', 'Cible mobile', 'service');

-- Mise en route du back-office (bo-socle, tests/e2e/gestion-mise-en-route.spec.ts) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('mise-en-route-bureau@laferme.test', 'Mise en route bureau', 'gerant'),
  ('mise-en-route-mobile@laferme.test', 'Mise en route mobile', 'gerant');

-- Heure promise réaliste et base de test (bo-operations, #241). La base embarquée est commune à tous les tests e2e et
-- reçoit des centaines de commandes en quelques minutes. Avec le four compté (15 pizzas par quart d'heure, migration
-- 20261213140000, valeur de production), leur file allongeait toutes les heures promises selon l'ordre des tests :
-- créneaux et messages des pages à heure simulée, tickets reportés à plus tard, lignes de la tablette. Ici, le four
-- reste à 0 (ignoré), comme cuisine et livreurs. Le calcul avec 15 est vérifié par les tests qui posent leur propre
-- débit (tests/unit/heure-reelle-four.test.ts, heure-reelle-sql, charge-postes-sql).
update reglages set valeur = '0'::jsonb where cle = 'debit_pizza_quart_heure';

-- Commande prise au téléphone (bo-commandes, tests/e2e/tablette-telephone.spec.ts) : un membre de service par projet Playwright.
insert into personnel (email, nom, role) values
  ('telephone-bureau@laferme.test', 'Téléphone bureau', 'service'),
  ('telephone-mobile@laferme.test', 'Téléphone mobile', 'service');
