-- Réglages généraux au back-office (vague 3, bo-operations). Des valeurs que le gérant devait faire changer
-- par un développeur : e-mail qui reçoit les alertes (variable ALERTE_EMAIL), plafond des codes de connexion
-- des clients par jour, longueur d'un créneau, jours de commande à l'avance.
--
-- La table reglages est lisible par tous (le site en a besoin pour les créneaux). Une adresse e-mail n'y va
-- pas : reglages_prives, sans aucun droit pour anon ni authenticated, lue par le serveur seulement.
-- Pas d'objet partagé recréé : table et fonctions neuves ; les valeurs restent dans les clés existantes.

create table reglages_prives (
  cle text primary key check (cle ~ '^[a-z_]{2,40}$'),
  valeur jsonb,
  modifie_le timestamptz not null default now()
);
alter table reglages_prives enable row level security;
revoke all on reglages_prives from anon, authenticated;

-- Valeur proposée vide : tant que le gérant ne l'a pas saisie, la variable ALERTE_EMAIL de Netlify sert.
insert into reglages_prives (cle, valeur) values ('alerte_email', 'null') on conflict (cle) do nothing;

-- Un réglage général (gérant), borné, journalisé (objet « reglage »). Valeur en texte (même passage dans la
-- base embarquée et chez Supabase), null pour l'e-mail : revenir à la variable ALERTE_EMAIL.
--   plafond_codes_clients_jour : 20 à 450 (la boîte d'envoi du restaurant est limitée à 500 e-mails par jour,
--     confirmations comprises : au-delà, les codes videraient le quota) ;
--   creneau_minutes : 10, 15, 20 ou 30 ;
--   avance_jours : 0 à 14 ;
--   alerte_email : une adresse e-mail.
create function regler_reglage_general(p_cle text, p_valeur text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  n integer;
  avant jsonb;
  apres jsonb;
  email text := lower(btrim(coalesce(p_valeur, '')));
begin
  if p_cle = 'alerte_email' then
    if email = '' then
      apres := 'null'::jsonb;
    elsif char_length(email) > 120 or email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
      raise exception 'Adresse e-mail illisible';
    else
      apres := to_jsonb(email);
    end if;
    select valeur into avant from reglages_prives where cle = p_cle for update;
    update reglages_prives set valeur = apres, modifie_le = now() where cle = p_cle;
    -- L'adresse n'est pas recopiée dans le journal : seulement qu'elle a changé.
    insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
      values (p_personnel, qui, 'reglage', p_cle,
        case when avant is null or avant = 'null'::jsonb then to_jsonb('variable ALERTE_EMAIL'::text) else to_jsonb('adresse saisie'::text) end,
        case when apres = 'null'::jsonb then to_jsonb('variable ALERTE_EMAIL'::text) else to_jsonb('adresse saisie'::text) end);
    return apres;
  end if;

  if p_cle is null or p_cle not in ('plafond_codes_clients_jour', 'creneau_minutes', 'avance_jours') then
    raise exception 'Réglage inconnu';
  end if;
  if p_valeur is null or p_valeur !~ '^[0-9]{1,4}$' then
    raise exception 'Un nombre entier';
  end if;
  n := p_valeur::integer;
  if (p_cle = 'plafond_codes_clients_jour' and n not between 20 and 450)
    or (p_cle = 'creneau_minutes' and n not in (10, 15, 20, 30))
    or (p_cle = 'avance_jours' and n not between 0 and 14) then
    raise exception 'Valeur hors limites';
  end if;
  select valeur into avant from reglages where cle = p_cle for update;
  update reglages set valeur = to_jsonb(n), proposition = false where cle = p_cle;
  perform journaliser(p_personnel, 'reglage', p_cle, avant, to_jsonb(n));
  return to_jsonb(n);
end;
$$;

-- Lecture pour le back-office (gérant) et pour le serveur (alertes).
create function reglages_generaux() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'plafond_codes_clients_jour', (select valeur from reglages where cle = 'plafond_codes_clients_jour'),
    'creneau_minutes', (select valeur from reglages where cle = 'creneau_minutes'),
    'avance_jours', (select valeur from reglages where cle = 'avance_jours'),
    'alerte_email', (select valeur from reglages_prives where cle = 'alerte_email')
  );
$$;

revoke execute on function regler_reglage_general(text, text, uuid), reglages_generaux() from public, anon, authenticated;
grant execute on function regler_reglage_general(text, text, uuid), reglages_generaux() to service_role;
