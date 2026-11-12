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
  ('carte-mobile@laferme.test', 'Carte mobile', 'gerant');
