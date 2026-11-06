-- Base embarquée seulement (développement et tests), jamais appliquée sur Supabase.
-- Un membre d'équipe par projet Playwright : la limite d'un code par 30 secondes est par e-mail.
insert into personnel (email, nom, role) values
  ('equipe-bureau@laferme.test', 'Test bureau', 'service'),
  ('equipe-mobile@laferme.test', 'Test mobile', 'service');
