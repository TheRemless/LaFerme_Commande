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
  ('recherche-mobile@laferme.test', 'Recherche mobile', 'gerant');

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

-- Chiffres et journal (bo-pilotage, tests/e2e/gestion-journal.spec.ts, vague 3) : un compte par projet Playwright.
insert into personnel (email, nom, role) values
  ('pilotage-bureau@laferme.test', 'Pilotage bureau', 'gerant'),
  ('pilotage-mobile@laferme.test', 'Pilotage mobile', 'gerant');

-- Planning des livreurs (tests/e2e/planning-livreurs.spec.ts, vague 3) : un gérant et un livreur à part.
insert into personnel (email, nom, role) values
  ('planning-bureau@laferme.test', 'Planning bureau', 'gerant'),
  ('planning-livreur@laferme.test', 'Livreur planning', 'livreur');

-- Réglages généraux (tests/e2e/reglages-generaux.spec.ts, vague 3).
insert into personnel (email, nom, role) values ('reglages-bureau@laferme.test', 'Réglages bureau', 'gerant');

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
  ('groupes-mobile@laferme.test', 'Groupes mobile', 'gerant');
