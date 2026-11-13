-- Renvoyer les tickets d'une imprimante en panne sur une autre, d'un geste (vague 3, bo-operations ; P1 de
-- produit-gestion). Le four est sans papier ou l'imprimante pizza ne répond plus : ses tickets en attente, envoyés
-- sans confirmation ou en échec partent sur l'autre imprimante, au lieu d'attendre son retour.
--
-- Seulement les tickets des commandes encore à préparer (acceptées ou en préparation), jamais les tickets de
-- test (ils restent sur leur imprimante, voir 20261203130000_essai_jamais_deplace.sql). Un ticket déjà envoyé
-- (peut-être sorti) repart marqué « RENVOI » (relance, comme après une confirmation perdue). Le ticket garde son
-- poste : un ticket pizza sorti en cuisine dit toujours PIZZA. Gérant seulement, journalisé.
-- Aucune fonction partagée recréée.

create function renvoyer_tickets(p_de smallint, p_vers smallint, p_personnel uuid) returns integer
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  de imprimantes%rowtype;
  vers imprimantes%rowtype;
  n integer;
begin
  if p_de is null or p_vers is null or p_de = p_vers then
    raise exception 'Choisissez une autre imprimante';
  end if;
  select * into de from imprimantes where id = p_de;
  if not found then
    raise exception 'Imprimante inconnue';
  end if;
  select * into vers from imprimantes where id = p_vers;
  if not found or not vers.actif then
    raise exception 'Imprimante de destination désactivée';
  end if;
  update taches_impression t set imprimante_id = p_vers, etat = 'en_attente', relance = (t.etat = 'envoyee'), tentatives = 0
    where t.imprimante_id = p_de
      and t.etat in ('en_attente', 'envoyee', 'echec')
      and t.commande_id is not null
      and exists (select 1 from commandes c where c.id = t.commande_id and c.statut in ('acceptee', 'en_preparation'));
  get diagnostics n = row_count;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'imprimante', 'renvoyer_tickets', jsonb_build_object('imprimante', de.id, 'nom', de.nom),
      jsonb_build_object('imprimante', vers.id, 'nom', vers.nom, 'tickets', n));
  return n;
end;
$$;

revoke execute on function renvoyer_tickets(smallint, smallint, uuid) from public, anon, authenticated;
grant execute on function renvoyer_tickets(smallint, smallint, uuid) to service_role;
