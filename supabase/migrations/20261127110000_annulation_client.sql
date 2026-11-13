-- Vague 3, bo-commandes : le client annule lui-même sa commande tant qu'elle n'est pas acceptée (arbitrage C1).
-- Règle envers le client, décision de Jérémy : désactivée par défaut (réglage annulation_client_active).
-- L'activer : update reglages set valeur = 'true', proposition = false where cle = 'annulation_client_active';
--
-- Statut « refusee » comme un refus de la tablette (tablette, exports et comptes le connaissent déjà), motif
-- « Annulée à votre demande. » (MOTIF_DEMANDE_CLIENT), et une colonne qui dit que c'est le client : le suivi
-- écrit « Vous avez annulé », la tablette fige la carte, les chiffres ne la comptent pas comme un refus.
-- L'acceptation et l'annulation se disputent le même verrou de ligne : la première arrivée gagne.
--
-- Objets partagés recréés : aucun (colonne ajoutée en fin de table, fonction neuve).
-- Compatible avant et après : le code de main n'écrit ni ne lit la colonne.

alter table commandes add column annulee_par_client_le timestamptz;

insert into reglages (cle, valeur, proposition) values ('annulation_client_active', 'false', true)
on conflict (cle) do nothing;

-- Rend : desactivee | inconnue | annulee | deja_annulee | deja_acceptee | impossible.
-- deja_acceptee : la tablette a accepté avant (ou en même temps) ; impossible : paiement pas encore fait,
-- commande refusée par le restaurant ou terminée.
create function annuler_par_client(p_jeton text, p_motif text) returns jsonb
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  if not coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'annulation_client_active' and jsonb_typeof(valeur) = 'boolean'), false) then
    return jsonb_build_object('resultat', 'desactivee');
  end if;
  if coalesce(btrim(p_motif), '') = '' then
    raise exception 'motif_invalide';
  end if;
  select * into c from commandes where jeton_suivi = p_jeton for update;
  if not found then
    return jsonb_build_object('resultat', 'inconnue');
  end if;
  if c.annulee_par_client_le is not null then
    return jsonb_build_object('resultat', 'deja_annulee', 'id', c.id);
  end if;
  if c.statut in ('acceptee', 'en_preparation', 'prete', 'partie', 'terminee') then
    return jsonb_build_object('resultat', 'deja_acceptee', 'id', c.id);
  end if;
  if c.statut <> 'nouvelle' then
    return jsonb_build_object('resultat', 'impossible', 'id', c.id);
  end if;
  update commandes set statut = 'refusee', motif = btrim(p_motif), termine_le = now(), annulee_par_client_le = now()
    where id = c.id;
  insert into evenements_commande (commande_id, de, vers, par, detail) values (c.id, c.statut, 'refusee', 'client', btrim(p_motif));
  return jsonb_build_object('resultat', 'annulee', 'id', c.id);
end;
$$;

revoke execute on function annuler_par_client(text, text) from public, anon, authenticated;
grant execute on function annuler_par_client(text, text) to service_role;
