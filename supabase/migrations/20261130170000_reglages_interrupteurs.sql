-- Réglages généraux, deux interrupteurs de plus (vague 3, bo-operations), demandés par client-commande :
--   plats_populaires_actifs : section « Les plus commandés » en tête de la carte ;
--   suggestion_panier_active : une boisson ou un dessert proposé au panier.
-- Les deux sont créés à false par 20261201120000_plats_populaires.sql (client-commande) et attendent la
-- décision C7 de Jérémy. Ici, seulement le moyen de les changer au back-office : oui ou non, gérant, journalisé.
--
-- Objets recréés (mes fonctions, de 20261130130000_reglages_generaux.sql) : regler_reglage_general et
-- reglages_generaux, repris de leur dernière définition dans main, avec seulement ces deux clés en plus.
-- Compatible avant et après : avant, le code envoie une clé que la fonction refuse (« Réglage inconnu »,
-- erreur claire, rien d'écrit) ; après, elle l'accepte.

create or replace function regler_reglage_general(p_cle text, p_valeur text, p_personnel uuid) returns jsonb
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

  if p_cle in ('annulation_client_active', 'plats_populaires_actifs', 'suggestion_panier_active') then
    if p_valeur is null or p_valeur not in ('true', 'false') then
      raise exception 'Oui ou non';
    end if;
    select valeur into avant from reglages where cle = p_cle for update;
    if not found then
      raise exception 'Réglage inconnu';
    end if;
    update reglages set valeur = to_jsonb(p_valeur::boolean), proposition = false where cle = p_cle;
    perform journaliser(p_personnel, 'reglage', p_cle, avant, to_jsonb(p_valeur::boolean));
    return to_jsonb(p_valeur::boolean);
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

create or replace function reglages_generaux() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'plafond_codes_clients_jour', (select valeur from reglages where cle = 'plafond_codes_clients_jour'),
    'creneau_minutes', (select valeur from reglages where cle = 'creneau_minutes'),
    'avance_jours', (select valeur from reglages where cle = 'avance_jours'),
    'alerte_email', (select valeur from reglages_prives where cle = 'alerte_email'),
    'annulation_client_active', coalesce((select valeur from reglages where cle = 'annulation_client_active'), 'false'::jsonb),
    'plats_populaires_actifs', coalesce((select valeur from reglages where cle = 'plats_populaires_actifs'), 'false'::jsonb),
    'suggestion_panier_active', coalesce((select valeur from reglages where cle = 'suggestion_panier_active'), 'false'::jsonb)
  );
$$;
