-- Vague 3, bo-commandes : renvoyer au client un e-mail déjà envoyé pour sa commande (« je n'ai rien reçu »).
-- Le serveur relit le message complet, HTML compris, pour le renvoyer à l'adresse de la commande. Le HTML ne
-- part jamais vers l'écran du back-office (courriel_commande_gestion ne rend que le texte).
-- Objets partagés recréés : aucun. Compatible avant et après : le code de main n'appelle pas cette fonction.

create function courriel_a_renvoyer(p_commande uuid, p_courriel uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('sujet', m.sujet, 'texte', m.texte, 'html', m.html)
  from courriels m where m.id = p_courriel and m.commande_id = p_commande;
$$;

revoke execute on function courriel_a_renvoyer(uuid, uuid) from public, anon, authenticated;
grant execute on function courriel_a_renvoyer(uuid, uuid) to service_role;
