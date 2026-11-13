-- Vague 3, client-compte : un client qui a commandé en invité retrouve ses commandes en se connectant.
-- Le code reçu par e-mail prouve l'adresse ; les commandes enregistrées avec elle et sans compte sont rangées
-- dans le sien (avant : seulement la commande du lien de suivi). Une commande détachée par la suppression
-- d'un compte reste à la comptabilité et n'est jamais rangée de nouveau.
-- Ajouts : colonnes commandes.detachee_du_compte et commandes.rangee_par_email (en fin de table),
-- déclencheur, fonction neuve. Objet recréé : export_compte(uuid, text), depuis sa seule définition
-- (20261108090000_comptes.sql), avec un seul changement : téléphone et détails de livraison retirés des
-- commandes rangées par e-mail. Aucun UPDATE ni DELETE sur des données existantes : les commandes déjà
-- détachées avant cette migration (comptes de test supprimés) ne sont pas distinguables, rien en production.

alter table commandes add column detachee_du_compte boolean not null default false;
-- Rangée dans un compte par la seule preuve de l'e-mail (pas par le lien de suivi ni la case « créer mon compte »).
alter table commandes add column rangee_par_email boolean not null default false;

-- Le compte d'une commande passe à vide (suppression du compte) : la commande est marquée détachée.
create function marquer_commande_detachee() returns trigger
language plpgsql as $$
begin
  if old.compte_id is not null and new.compte_id is null then
    new.detachee_du_compte := true;
  end if;
  return new;
end;
$$;
create trigger commandes_detachee before update of compte_id on commandes
  for each row execute function marquer_commande_detachee();
revoke execute on function marquer_commande_detachee() from public, anon, authenticated;

-- Appelée par le serveur juste après une connexion réussie (code vérifié). Rend le nombre de commandes rangées.
-- Index utilisé : commandes_email_idx (lower(client_email), cree_le desc).
create function rattacher_commandes_email(p_compte uuid) returns integer
language plpgsql as $$
declare
  e text;
  n integer;
begin
  select email into e from comptes where id = p_compte;
  if e is null then
    return 0;
  end if;
  with r as (
    update commandes set compte_id = p_compte, rangee_par_email = true
    where lower(client_email) = e and compte_id is null and not detachee_du_compte
      and statut not in ('paiement_en_attente', 'annulee')
    returning id, cree_le
  )
  select count(*)::integer into n from r;
  -- Ni le profil ni les adresses ne sont recopiés, et l'export retire téléphone et détails de livraison de
  -- ces commandes : une commande passée avec une adresse e-mail mal tapée donnerait sinon le téléphone et le
  -- code d'entrée d'un inconnu au titulaire de cette adresse. Il ne voit que ce que l'e-mail de confirmation
  -- lui a déjà montré.
  return n;
end;
$$;
revoke execute on function rattacher_commandes_email(uuid) from public, anon, authenticated;
grant execute on function rattacher_commandes_email(uuid) to service_role;

-- Export des données du compte : même définition que 20261108090000_comptes.sql, sauf les commandes rangées
-- par e-mail, sans client_telephone ni details_livraison.
create or replace function export_compte(p_compte uuid, p_ip_court text) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  select jsonb_build_object(
    'export_le', now(),
    'compte', jsonb_build_object('email', c.email, 'prenom', c.prenom, 'nom', c.nom, 'telephone', c.telephone, 'cree_le', c.cree_le, 'modifie_le', c.modifie_le),
    'adresses', coalesce((
      select jsonb_agg(jsonb_build_object('adresse', a.adresse, 'details', a.details, 'utilisee_le', a.utilisee_le) order by a.utilisee_le desc)
      from adresses_compte a where a.compte_id = c.id
    ), '[]'::jsonb),
    'commandes', coalesce((
      select jsonb_agg(
        (to_jsonb(o) - 'cle_idempotence' - 'origine' - 'compte_id' - 'stripe_session_id'
          - (case when o.rangee_par_email then array['client_telephone', 'details_livraison'] else array[]::text[] end)) || jsonb_build_object(
          'lignes', coalesce((
            select jsonb_agg(to_jsonb(l) - 'id' - 'commande_id' order by l.position)
            from commande_lignes l where l.commande_id = o.id
          ), '[]'::jsonb)
        ) order by o.cree_le desc)
      from commandes o where o.compte_id = c.id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('ouverte_le', s.cree_le, 'expire_le', s.expire_le, 'fermee_le', s.revoquee_le) order by s.cree_le desc)
      from sessions_compte s where s.compte_id = c.id
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('evenement', j.evenement, 'le', j.le) order by j.le desc)
      from journal_connexions j where j.compte_id = c.id
    ), '[]'::jsonb)
  ) into r
  from comptes c where c.id = p_compte;
  if r is not null then
    insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'export', p_ip_court);
  end if;
  return r;
end;
$$;
