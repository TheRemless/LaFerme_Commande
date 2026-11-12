-- Plafond global des codes de connexion des clients : 150 par 24 heures (décision de Jérémy du 12.11.2026).
-- Les e-mails partent par la boîte du restaurant chez Infomaniak, limitée à 500 envois par jour. Les limites
-- existantes (5 par heure et par adresse, 20 par heure et par IP) laissaient une seule IP envoyer 480 codes
-- par jour vers des adresses variées : quota vidé, plus de confirmation de commande ni de code pour
-- l'équipe jusqu'au lendemain. Au plafond, demander_code renvoie -2 et ne crée aucun code (-3 la première
-- fois par 24 heures : le site prévient alors le restaurant). Une même IP ne reçoit plus que 30 codes par
-- 24 heures : seule, elle ne peut plus atteindre le plafond et bloquer la connexion des autres clients.
-- Les codes de l'équipe (demander_code_personnel) ne comptent pas et ne sont pas plafonnés ici.
-- Ancien code compatible : il lit 0 ou un nombre de secondes ; à -2 il tenterait un envoi sans code valable,
-- d'où l'intérêt de lancer cette migration après le déploiement du code qui connaît -2.
-- Changer le plafond : update reglages set valeur = '200' where cle = 'plafond_codes_clients_jour';

insert into reglages (cle, valeur, proposition) values ('plafond_codes_clients_jour', '150', false)
on conflict (cle) do nothing;

-- Liste complète reprise de 20261112090000_correctifs_securite.sql, plus le compteur global.
alter table tentatives_connexion drop constraint tentatives_connexion_action_check;
alter table tentatives_connexion add constraint tentatives_connexion_action_check
  check (action in ('envoi_email', 'envoi_ip', 'echec_ip', 'echec_email', 'comptoir_ip', 'envoi_global'));

-- Réglage absent, illisible ou inférieur à 1 : 150. Borné à 100 000 pour ne jamais déborder un entier.
create function plafond_codes_clients() returns integer
language sql stable as $$
  select coalesce(
    (select least(floor((valeur #>> '{}')::numeric), 100000)::integer from reglages
     where cle = 'plafond_codes_clients_jour' and jsonb_typeof(valeur) = 'number' and (valeur #>> '{}')::numeric >= 1),
    150);
$$;
revoke all on function plafond_codes_clients() from public, anon, authenticated;
grant execute on function plafond_codes_clients() to service_role;

-- Définition reprise de 20261108090000_comptes.sql (la seule), avec le plafond global et la limite par IP
-- sur 24 heures. Une demande refusée, par le plafond ou par une limite, ne consomme rien.
create or replace function demander_code(p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text)
returns integer
language plpgsql as $$
declare
  a integer;
  cid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  -- Ménage, une demande sur vingt : les compteurs vivent un jour, les codes un jour, le journal six mois.
  if random() < 0.05 then
    delete from tentatives_connexion where le < now() - interval '1 day';
    delete from codes_connexion where cree_le < now() - interval '1 day';
    delete from sessions_compte where expire_le < now() - interval '30 days' or revoquee_le < now() - interval '30 days';
    delete from journal_connexions where le < now() - interval '180 days';
  end if;

  select id into cid from comptes where email = p_email;
  -- Plafond tous clients confondus, sur 24 heures glissantes, compté sous un verrou commun (pris après le
  -- verrou par adresse, toujours dans cet ordre). Testé avant les limites par adresse : au plafond, la
  -- réponse est la même pour tous, que le compte existe ou non et que l'adresse ait déjà demandé un code ou non.
  perform pg_advisory_xact_lock(hashtext('codes_clients'));
  if (select count(*) from tentatives_connexion
      where action = 'envoi_global' and cle = 'codes_clients' and le > now() - interval '1 day') >= plafond_codes_clients() then
    insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'code_limite', p_ip_court);
    -- Premier refus en 24 heures : -3, le site prévient le restaurant une seule fois.
    if not exists (select 1 from tentatives_connexion
                   where action = 'envoi_global' and cle = 'alerte_plafond' and le > now() - interval '1 day') then
      insert into tentatives_connexion (action, cle) values ('envoi_global', 'alerte_plafond');
      return -3;
    end if;
    return -2;
  end if;
  -- Par e-mail : un code tout de suite, puis 30 s, 1 min, 2 min, 4 min d'attente, cinq par heure au plus.
  -- Par IP : vingt par heure (un réseau partagé, comme un bureau, ne doit pas bloquer trop vite) et trente
  -- par 24 heures (une seule IP ne prend qu'une part du plafond global).
  a := greatest(
    attente_limite('envoi_email', p_cle_email, 5, interval '1 hour', 30, 1),
    attente_limite('envoi_ip', p_cle_ip, 20, interval '1 hour', 0, 0),
    attente_limite('envoi_ip', p_cle_ip, 30, interval '1 day', 0, 0)
  );
  if a > 0 then
    insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'code_limite', p_ip_court);
    return a;
  end if;
  insert into tentatives_connexion (action, cle)
  values ('envoi_email', p_cle_email), ('envoi_ip', p_cle_ip), ('envoi_global', 'codes_clients');
  update codes_connexion set invalide_le = now()
    where cle_email = p_cle_email and utilise_le is null and invalide_le is null;
  insert into codes_connexion (cle_email, code_hache, expire_le) values (p_cle_email, p_code_hache, now() + interval '10 minutes');
  insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'code_demande', p_ip_court);
  return 0;
end;
$$;
