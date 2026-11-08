-- Base embarquée seulement (développement et tests), jamais appliquée sur Supabase.
-- Un membre d'équipe par projet Playwright : la limite d'un code par 30 secondes est par e-mail.
insert into personnel (email, nom, role) values
  ('equipe-bureau@laferme.test', 'Test bureau', 'service'),
  ('equipe-mobile@laferme.test', 'Test mobile', 'service'),
  ('gerant-bureau@laferme.test', 'Gérant bureau', 'gerant'),
  ('gerant-mobile@laferme.test', 'Gérant mobile', 'gerant'),
  ('cuisine-bureau@laferme.test', 'Cuisine bureau', 'service'),
  ('cuisine-mobile@laferme.test', 'Cuisine mobile', 'service'),
  ('impression@laferme.test', 'Test impression', 'gerant'),
  ('a11y-bureau@laferme.test', 'Test accessibilité bureau', 'gerant'),
  ('a11y-mobile@laferme.test', 'Test accessibilité mobile', 'gerant');
