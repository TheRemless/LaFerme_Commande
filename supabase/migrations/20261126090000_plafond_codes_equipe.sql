-- Plafond global des codes de connexion de l'équipe sur 24 heures (vague 3, bo-socle, signalé par la revue de
-- sécurité de client-compte). Les codes de l'équipe ne comptaient dans aucun plafond global : avec trois
-- adresses de l'équipe connues, un tiers pouvait faire partir environ 360 codes par jour et user le quota
-- d'envoi de la boîte du restaurant (500 par jour).
-- Construit DÉSACTIVÉ : la valeur est un nombre d'e-mails par jour, donc une décision de Jérémy (question
-- au carnet). Sans réglage, rien ne change. Pour l'activer :
--   insert into reglages (cle, valeur, proposition) values ('plafond_codes_personnel_jour', '<nombre>', false)
--   on conflict (cle) do update set valeur = excluded.valeur, proposition = false;
-- Compteur à part de celui des clients : un client ne peut jamais bloquer la connexion de l'équipe.
-- Au plafond : -2 (même réponse qu'une adresse inconnue, aucun code créé), -3 la première fois par
-- 24 heures (le site prévient alors le restaurant). Seuls les codes réellement créés pour un membre actif
-- comptent : une adresse inconnue ne consomme rien.
-- Ancien code compatible : il traite toute valeur négative comme « envoyé », sans courriel.

-- Réglage absent, illisible ou inférieur à 1 : pas de plafond (null).
create function plafond_codes_personnel() returns integer
language sql stable as $$
  select least(floor((valeur #>> '{}')::numeric), 100000)::integer from reglages
  where cle = 'plafond_codes_personnel_jour' and jsonb_typeof(valeur) = 'number' and (valeur #>> '{}')::numeric >= 1;
$$;
revoke all on function plafond_codes_personnel() from public, anon, authenticated;
grant execute on function plafond_codes_personnel() to service_role;

-- Définition reprise de 20261109090000_tablette.sql (la seule dans main), avec le plafond après le contrôle
-- de l'adresse.
create or replace function demander_code_personnel(p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text)
returns integer
language plpgsql as $$
declare
  a integer;
  pid uuid;
  plafond integer := plafond_codes_personnel();
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  a := greatest(
    attente_limite('envoi_email', p_cle_email, 5, interval '1 hour', 30, 1),
    attente_limite('envoi_ip', p_cle_ip, 20, interval '1 hour', 0, 0)
  );
  if a > 0 then
    return a;
  end if;
  insert into tentatives_connexion (action, cle) values ('envoi_email', p_cle_email), ('envoi_ip', p_cle_ip);
  select id into pid from personnel where email = p_email and actif;
  if pid is null then
    return -1;
  end if;
  if plafond is not null then
    -- Compté sous un verrou commun, pris après le verrou par adresse (toujours dans cet ordre).
    perform pg_advisory_xact_lock(hashtext('codes_personnel'));
    if (select count(*) from tentatives_connexion
        where action = 'envoi_global' and cle = 'codes_personnel' and le > now() - interval '1 day') >= plafond then
      insert into journal_personnel (personnel_id, evenement, ip_court) values (pid, 'code_limite', p_ip_court);
      if not exists (select 1 from tentatives_connexion
                     where action = 'envoi_global' and cle = 'alerte_plafond_personnel' and le > now() - interval '1 day') then
        insert into tentatives_connexion (action, cle) values ('envoi_global', 'alerte_plafond_personnel');
        return -3;
      end if;
      return -2;
    end if;
    insert into tentatives_connexion (action, cle) values ('envoi_global', 'codes_personnel');
  end if;
  update codes_connexion set invalide_le = now()
    where cle_email = p_cle_email and utilise_le is null and invalide_le is null;
  insert into codes_connexion (cle_email, code_hache, expire_le) values (p_cle_email, p_code_hache, now() + interval '10 minutes');
  insert into journal_personnel (personnel_id, evenement, ip_court) values (pid, 'code_demande', p_ip_court);
  return 0;
end;
$$;
