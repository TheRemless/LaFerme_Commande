-- Rythme de la cuisine au back-office (vague 3, bo-operations) : les réglages de l'heure promise réaliste
-- (20261130100000_heure_reelle.sql) ne se changeaient qu'en base. Le gérant les règle maintenant comme les
-- autres réglages généraux, bornés et journalisés :
--   debit_pizza_quart_heure, debit_cuisine_quart_heure : 0 à 100 articles par quart d'heure (0 : non compté) ;
--   allongement_max_minutes : 0 à 90 ;
--   fourchette_livraison_minutes, fourchette_retrait_minutes : 0 à 60.
-- Les débits restent à 0 tant que Jérémy n'a pas donné ses chiffres (question D8) : rien ne change seul.
--
-- Objets recréés (mes fonctions) : regler_reglage_general et reglages_generaux, repris de leur dernière
-- définition (20261130170000_reglages_interrupteurs.sql) avec seulement ces clés en plus.
-- Compatible avant et après : avant, ces clés sont refusées (« Réglage inconnu ») et l'écran ne montre pas le bloc.

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

  if p_cle is null or p_cle not in ('plafond_codes_clients_jour', 'creneau_minutes', 'avance_jours',
      'debit_pizza_quart_heure', 'debit_cuisine_quart_heure', 'allongement_max_minutes',
      'fourchette_livraison_minutes', 'fourchette_retrait_minutes') then
    raise exception 'Réglage inconnu';
  end if;
  if p_valeur is null or p_valeur !~ '^[0-9]{1,4}$' then
    raise exception 'Un nombre entier';
  end if;
  n := p_valeur::integer;
  if (p_cle = 'plafond_codes_clients_jour' and n not between 20 and 450)
    or (p_cle = 'creneau_minutes' and n not in (10, 15, 20, 30))
    or (p_cle = 'avance_jours' and n not between 0 and 14)
    or (p_cle in ('debit_pizza_quart_heure', 'debit_cuisine_quart_heure') and n not between 0 and 100)
    or (p_cle = 'allongement_max_minutes' and n not between 0 and 90)
    or (p_cle in ('fourchette_livraison_minutes', 'fourchette_retrait_minutes') and n not between 0 and 60) then
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
    'suggestion_panier_active', coalesce((select valeur from reglages where cle = 'suggestion_panier_active'), 'false'::jsonb),
    'rythme', (select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from reglages where cle in (
      'debit_pizza_quart_heure', 'debit_cuisine_quart_heure', 'allongement_max_minutes',
      'fourchette_livraison_minutes', 'fourchette_retrait_minutes'))
  );
$$;
