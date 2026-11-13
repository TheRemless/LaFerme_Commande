-- Ticket de test (vague 3, tablette, demandé par bo-operations) : le gérant vérifie qu'une imprimante sort bien un
-- ticket sans passer une vraie commande (docs/impression.md, S13). Une tâche « essai » sans commande, envoyée par
-- CloudPRNT et confirmée comme les autres (passage_imprimante, tache_pour_imprimante, confirmer_tache inchangées).
--
-- Aucune fonction partagée recréée. Les lectures existantes joignent sur commande_id ou filtrent par commande :
-- une tâche sans commande n'y apparaît pas. Lecture seule de taches_impression ailleurs : filtrer
-- « commande_id is not null » pour ne pas compter les essais.

alter table taches_impression alter column commande_id drop not null;
alter table taches_impression add column essai boolean not null default false;
alter table taches_impression add constraint taches_impression_commande_ou_essai check (commande_id is not null or essai);

-- Gérant seulement (revérifié ici), imprimante active. Contenu figé, au format des lignes de ticket
-- (src/lib/impression/ticket.ts, LigneTicket). Renvoie l'id de la tâche.
create function ticket_de_test(p_imprimante smallint, p_personnel uuid) returns uuid
language plpgsql as $$
declare
  qui text;
  imp imprimantes%rowtype;
  t uuid;
  quand text := to_char(now() at time zone 'Europe/Zurich', 'DD.MM.YYYY "à" HH24"h"MI');
begin
  select nom into qui from personnel where id = p_personnel and actif and role = 'gerant';
  if qui is null then
    raise exception 'Réservé au gérant';
  end if;
  select * into imp from imprimantes where id = p_imprimante;
  if not found then
    raise exception 'Imprimante inconnue';
  end if;
  if not imp.actif then
    raise exception 'Imprimante désactivée : réactivez-la avant le test';
  end if;
  insert into taches_impression (commande_id, essai, station, imprimante_id, contenu, etat)
    values (null, true, imp.station, imp.id, jsonb_build_array(
      jsonb_build_object('t', 'texte', 'texte', 'TEST', 'taille', 3, 'gras', true),
      jsonb_build_object('t', 'deux', 'gauche', case imp.station when 'pizza' then 'PIZZA' else 'CUISINE' end, 'droite', imp.nom, 'taille', 2, 'gras', true),
      jsonb_build_object('t', 'filet'),
      jsonb_build_object('t', 'texte', 'texte', 'Le ' || quand),
      jsonb_build_object('t', 'texte', 'texte', 'Demandé par ' || qui),
      jsonb_build_object('t', 'texte', 'texte', 'Si ce ticket sort, l''imprimante est bien branchée.', 'gras', true)
    ), 'en_attente')
    returning id into t;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'imprimante', 'ticket_de_test', null, jsonb_build_object('imprimante', imp.id, 'nom', imp.nom, 'tache', t));
  return t;
end;
$$;

revoke all on function ticket_de_test(smallint, uuid) from public, anon, authenticated;
grant execute on function ticket_de_test(smallint, uuid) to service_role;
