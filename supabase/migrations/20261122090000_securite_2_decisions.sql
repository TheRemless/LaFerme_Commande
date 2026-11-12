-- Décisions de Jérémy après l'audit de sécurité 2 (docs/audits/securite-2.md), validées le 12.11.2026 :
-- S2-01 (annuler une livraison partie : gérant seulement), S2-02 (prix repassé « à valider » : hors de la
-- vente jusqu'à validation), S2-10 (aucun plat à CHF 0), S2-15 (session d'un livreur : 12 heures).
-- Objets recréés : annuler_commande_partie (nouvelle signature, l'ancienne est supprimée) et
-- personnel_de_session (même signature, depuis 20261109090000_tablette.sql). Aucun UPDATE ni DELETE sur des données.

-- ---------- S2-01 : annuler une livraison partie ----------
-- L'annulation rembourse tout le client. Avant, tout membre de la tablette pouvait la faire ; la route le
-- refuse désormais à qui n'est pas gérant, et la base le revérifie avec l'identifiant du membre.
drop function annuler_commande_partie(uuid, text, text);
create function annuler_commande_partie(p_commande uuid, p_par text, p_motif text, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  perform gerant_nom(p_personnel);
  select * into c from commandes where id = p_commande for update;
  if not found or c.statut <> 'partie' or coalesce(btrim(p_motif), '') = '' then
    return false;
  end if;
  update commandes set statut = 'refusee', termine_le = now(), motif = btrim(p_motif) where id = p_commande;
  insert into evenements_commande (commande_id, de, vers, par, detail) values (p_commande, 'partie', 'refusee', p_par, btrim(p_motif));
  return true;
end;
$$;
revoke execute on function annuler_commande_partie(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function annuler_commande_partie(uuid, text, text, uuid) to service_role;

-- ---------- S2-02 : un prix repassé « à valider » sort le plat de la vente ----------
-- Avant le lancement, les plats de la carte attendent leur validation tout en restant en vente (le build de
-- production les bloque). Après, un plat validé dont le prix change sans validation restait en vente au prix
-- non validé, et bloquait tout build. Désormais il sort de la vente, et y revient seul à la validation.
-- Par toutes les voies (fiche, import du tableau, retour arrière du journal) : déclencheur sur la table.
-- Le plat du jour n'est pas concerné (son prix vaut dès la saisie, décision du 12.11.2026).
alter table plats add column retire_prix_a_valider boolean not null default false;

create function retirer_plat_prix_a_valider() returns trigger
language plpgsql as $$
begin
  if new.origine = 'jour' then
    return new;
  end if;
  if new.prix_a_valider and new.commandable and (not old.prix_a_valider or old.retire_prix_a_valider) then
    if old.commandable then
      -- Prix validé qui repasse à valider : hors de la vente jusqu'à la validation.
      new.commandable := false;
      new.retire_prix_a_valider := true;
    else
      -- Remis en vente à la main sans valider le prix.
      raise exception 'plat_incomplet: prix à valider';
    end if;
  elsif old.retire_prix_a_valider and not new.prix_a_valider then
    -- Prix validé : retour en vente, sauf si le gérant a changé la vente dans le même geste ou archivé le plat.
    if new.commandable = old.commandable and new.archive_le is null then
      new.commandable := true;
    end if;
    new.retire_prix_a_valider := false;
  elsif old.commandable is distinct from new.commandable then
    new.retire_prix_a_valider := false;
  end if;
  return new;
end;
$$;
create trigger plats_retrait_prix_a_valider before update on plats
  for each row execute function retirer_plat_prix_a_valider();
revoke execute on function retirer_plat_prix_a_valider() from public, anon, authenticated;

-- ---------- S2-10 : aucun plat gratuit ----------
-- 0 est une faute de frappe (un plat du jour est vendu dès la saisie). Les options peuvent rester à 0.
-- NOT VALID : aucune ligne existante n'est relue (aucune n'est à 0 dans la carte), les écritures le sont.
alter table plats add constraint plats_prix_positif check (prix_centimes > 0) not valid;

-- ---------- S2-15 : session d'un livreur, 12 heures ----------
-- Le téléphone d'un livreur est personnel et se perd. La tablette et le back-office gardent 60 jours.
create function borner_session_livreur() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from personnel where id = new.personnel_id and role = 'livreur') then
    new.expire_le := least(new.expire_le, now() + interval '12 hours');
  end if;
  return new;
end;
$$;
create trigger sessions_personnel_livreur before insert on sessions_personnel
  for each row execute function borner_session_livreur();
revoke execute on function borner_session_livreur() from public, anon, authenticated;

-- Un membre passé livreur après sa connexion ne garde pas une session de 60 jours.
create or replace function personnel_de_session(p_session_hache text) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'nom', p.nom, 'role', p.role)
  from sessions_personnel s join personnel p on p.id = s.personnel_id
  where s.jeton_hache = p_session_hache and s.revoquee_le is null and s.expire_le > now() and p.actif
    and (p.role <> 'livreur' or s.cree_le > now() - interval '12 hours');
$$;
