-- Correctifs de l'audit de sécurité du 12.11.2026 (docs/audits/securite.md).

-- ---------- S1 : plus de membre d'équipe de test dans la vraie base ----------
-- Son code s'affichait à l'écran sur les préversions : n'importe qui devenait gérant de la base de production.
-- Ses sessions partent avec lui (on delete cascade) ; les journaux gardent l'événement, sans l'auteur.
-- La base embarquée le recrée pour les essais (supabase/local/donnees-test.sql).
delete from personnel where email = 'equipe@laferme.test';

-- ---------- S4 : plafond d'essais faux par e-mail sur 24 heures ----------
-- Avant : 5 essais par code et 5 codes par heure, soit 600 essais par jour sur une adresse. Désormais
-- 15 essais faux par jour au plus, quelle que soit l'IP. S5 ajoute aussi un compteur par IP.
alter table tentatives_connexion drop constraint tentatives_connexion_action_check;
alter table tentatives_connexion add constraint tentatives_connexion_action_check
  check (action in ('envoi_email', 'envoi_ip', 'echec_ip', 'echec_email', 'comptoir_ip'));

create function verifier_code_limite(
  p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text,
  p_session_hache text, p_ancienne_session_hache text default null, p_jeton_commande text default null
) returns jsonb
language plpgsql as $$
declare
  a integer;
  r jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  a := attente_limite('echec_email', p_cle_email, 15, interval '24 hours', 0, 0);
  if a > 0 then
    return jsonb_build_object('statut', 'attente', 'attente', a);
  end if;
  r := verifier_code(p_email, p_cle_email, p_cle_ip, p_code_hache, p_ip_court, p_session_hache, p_ancienne_session_hache, p_jeton_commande);
  if r ->> 'statut' = 'invalide' then
    insert into tentatives_connexion (action, cle) values ('echec_email', p_cle_email);
  end if;
  return r;
end;
$$;

create function verifier_code_personnel_limite(
  p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text,
  p_session_hache text, p_ancienne_session_hache text default null
) returns jsonb
language plpgsql as $$
declare
  a integer;
  r jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  a := attente_limite('echec_email', p_cle_email, 15, interval '24 hours', 0, 0);
  if a > 0 then
    return jsonb_build_object('statut', 'attente', 'attente', a);
  end if;
  r := verifier_code_personnel(p_email, p_cle_email, p_cle_ip, p_code_hache, p_ip_court, p_session_hache, p_ancienne_session_hache);
  if r ->> 'statut' = 'invalide' then
    insert into tentatives_connexion (action, cle) values ('echec_email', p_cle_email);
  end if;
  return r;
end;
$$;

-- ---------- S5 : commandes au comptoir ----------
-- Une commande au comptoir arrive sur la tablette sans paiement. Au plus deux à retirer par téléphone
-- ou par e-mail (sur un jour), et cinq par connexion et par heure. Renvoie 'ok', 'contact' ou 'ip'.
-- Un double clic (même clé) n'est pas une nouvelle commande. Téléphone comparé sur ses 9 derniers
-- chiffres : 079…, +41 79… et 0041 79… sont le même numéro.
create function limite_comptoir(p_telephone text, p_email text, p_cle_ip text, p_cle text) returns text
language plpgsql as $$
declare
  chiffres text := right(regexp_replace(p_telephone, '\D', '', 'g'), 9);
  email text := lower(btrim(p_email));
begin
  if exists (select 1 from commandes where cle_idempotence = p_cle) then
    return 'ok';
  end if;
  if (
    select count(*) from commandes
    where moyen_paiement = 'comptoir'
      and statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete')
      and cree_le > now() - interval '1 day'
      and (right(regexp_replace(client_telephone, '\D', '', 'g'), 9) = chiffres or client_email = email)
  ) >= 2 then
    return 'contact';
  end if;
  if attente_limite('comptoir_ip', p_cle_ip, 5, interval '1 hour', 0, 0) > 0 then
    return 'ip';
  end if;
  insert into tentatives_connexion (action, cle) values ('comptoir_ip', p_cle_ip);
  return 'ok';
end;
$$;

revoke execute on function
  verifier_code_limite(text, text, text, text, text, text, text, text),
  verifier_code_personnel_limite(text, text, text, text, text, text, text),
  limite_comptoir(text, text, text, text)
  from public, anon, authenticated;
grant execute on function
  verifier_code_limite(text, text, text, text, text, text, text, text),
  verifier_code_personnel_limite(text, text, text, text, text, text, text),
  limite_comptoir(text, text, text, text)
  to service_role;

-- ---------- S8 : aucun droit d'écriture pour les visiteurs ----------
-- Supabase donne par défaut tous les droits à anon et authenticated ; seule la sécurité par ligne
-- bloquait l'écriture. On ne leur laisse que la lecture.
revoke insert, update, delete, truncate on
  categories, plats, groupes_options, options, plat_groupes, plat_retraits,
  zones_livraison, zone_npa, horaires, fermetures, reglages
  from anon, authenticated;
