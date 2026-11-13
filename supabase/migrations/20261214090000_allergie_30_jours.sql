-- Vague 3, client-compte : allergie effacée 30 jours après la commande (C14, décision de Jérémy du 13.11.2026).
-- Donnée de santé (nLPD art. 5) : gardée le temps de préparer, livrer et traiter une réclamation (14 jours au
-- suivi), puis effacée de la commande et des tickets gardés pour la réimpression. Rien d'autre ne la copie :
-- ni le compte (completer_depuis_commande), ni les e-mails (ils disent seulement « allergie signalée »).
-- La surveillance appelle effacer_allergies_echues() à chaque tour ; l'index partiel ne contient que les
-- commandes dont l'allergie n'est pas encore effacée, le tour ne coûte rien quand il n'y a rien à faire.
--
-- Objet partagé recréé : le déclencheur commandes_modifie_le (20261107090000_commandes.sql), avec une
-- condition WHEN. Une mise à jour qui ne change QUE l'allergie ne date plus la commande : sinon une commande
-- terminée il y a 30 jours reviendrait dans « Terminées aujourd'hui » de la tablette (file_tablette lit
-- modifie_le). Toute autre mise à jour est datée comme avant, même sans changement.
--
-- Avant cette migration, le code appelle une fonction absente : la surveillance l'ignore (« does not exist »).

create index commandes_allergie_a_effacer_idx on commandes (cree_le) where allergie <> '';

drop trigger commandes_modifie_le on commandes;
create trigger commandes_modifie_le before update on commandes
  for each row
  when (
    old.allergie is not distinct from new.allergie
    or (to_jsonb(old) - 'allergie' - 'modifie_le') is distinct from (to_jsonb(new) - 'allergie' - 'modifie_le')
  )
  execute function maj_modifie_le();

-- Renvoie le nombre de commandes dont l'allergie vient d'être effacée.
create function effacer_allergies_echues() returns integer
language plpgsql as $$
declare
  n integer;
begin
  with echues as (
    update commandes set allergie = ''
    where allergie <> '' and cree_le < now() - interval '30 days'
    returning id
  ), tickets as (
    -- Lignes « ALLERGIE : … » des tickets (src/lib/impression/ticket.ts), retirées sans toucher au reste.
    update taches_impression t
    set contenu = (
      select coalesce(jsonb_agg(e.l order by e.i), '[]'::jsonb)
      from jsonb_array_elements(t.contenu) with ordinality as e(l, i)
      where not (e.l ->> 't' = 'texte' and e.l ->> 'texte' like 'ALLERGIE : %')
    )
    where t.commande_id in (select id from echues)
      and jsonb_typeof(t.contenu) = 'array'
    returning 1
  )
  select count(*) into n from echues;
  return n;
end;
$$;

revoke execute on function effacer_allergies_echues() from public, anon, authenticated;
grant execute on function effacer_allergies_echues() to service_role;
