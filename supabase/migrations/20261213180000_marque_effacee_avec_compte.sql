-- Vague 3, bo-commandes : la marque d'un client (« à surveiller », « bloqué ») part avec son compte.
-- Décision de Jérémy (13.11.2026, par le chef) : la marque n'est pas gardée après la suppression du compte.
-- Elle reste visible dans l'export tant que le compte existe.
--
-- Recrée effacer_notes_client (même nom et même signature pour supprimerCompte, src/lib/comptes/donnees.ts),
-- depuis 20261127120000_clients.sql : en plus des notes, la marque et ses lignes de journal (le motif y figure).
-- Renvoie toujours le nombre de notes effacées. Droits inchangés (create or replace).

create or replace function effacer_notes_client(p_email text) returns integer
language plpgsql as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  n integer;
begin
  delete from notes_client where email = e;
  get diagnostics n = row_count;
  delete from marques_client where email = e;
  -- Les lignes du journal qui nomment ce client par ses notes ou par sa marque (motif) partent aussi.
  delete from journal_gestion where objet in ('note_client', 'client') and cle = e;
  return n;
end;
$$;
