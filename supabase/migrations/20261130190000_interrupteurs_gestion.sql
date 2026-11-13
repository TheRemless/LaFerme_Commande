-- Interrupteurs du back-office (vague 3, bo-operations) : une table où chaque session déclare ses réglages
-- oui ou non (une ligne dans sa migration), au lieu de recréer regler_reglage_general à chaque fois.
-- La fonction accepte oui ou non pour toute clé déclarée ici ; l'écran « Réglages généraux » les liste seul,
-- avec le libellé et l'aide donnés. cache : ce que le serveur vide après un changement (catalogue : /carte et
-- /panier ; config-service : la config du service ; aucun).
--
-- Objets recréés (mes fonctions) : regler_reglage_general et reglages_generaux, reprises de
-- 20261130180000_reglages_rythme.sql. Les interrupteurs y sortent de la liste écrite en dur.
-- Compatible avant et après : avant, l'écran garde ses cases écrites en dur.

create table interrupteurs_gestion (
  cle text primary key check (cle ~ '^[a-z_]{2,40}$'),
  libelle text not null check (char_length(libelle) between 5 and 120),
  aide text check (aide is null or char_length(aide) <= 300),
  cache text not null default 'aucun' check (cache in ('aucun', 'catalogue', 'config-service')),
  ordre smallint not null default 100
);
alter table interrupteurs_gestion enable row level security;
revoke all on interrupteurs_gestion from anon, authenticated;

insert into interrupteurs_gestion (cle, libelle, aide, cache, ordre) values
  ('annulation_client_active', 'Le client peut annuler sa commande depuis son suivi',
    'Tant que la commande n''est pas acceptée. Remboursée en entier. Décochée au départ, en attente de la décision de Jérémy (C1).', 'config-service', 10),
  ('plats_populaires_actifs', '« Les plus commandés » en tête de la carte',
    'Les plats les plus commandés des 28 derniers jours. Décochée au départ, en attente de la décision de Jérémy (C7).', 'catalogue', 20),
  ('suggestion_panier_active', 'Proposer une boisson ou un dessert au panier',
    'Le plus commandé de sa catégorie. Décochée au départ, en attente de la décision de Jérémy (C7).', 'catalogue', 30),
  -- Interrupteurs de client-commande (20261210210000_couverts_prenoms.sql), libellés et caches donnés par elle.
  ('couverts_actifs', 'Proposer couverts et serviettes au paiement',
    'C8 : case décochée par défaut ; la cuisine voit + COUVERTS.', 'aucun', 40),
  ('prenom_par_ligne_actif', 'Proposer un prénom par plat (« pour Léa »)',
    'C5 : pour une famille sur un seul téléphone ; le prénom est imprimé sous le plat.', 'catalogue', 50)
  on conflict (cle) do nothing;

create or replace function regler_reglage_general(p_cle text, p_valeur text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := gerant_nom(p_personnel);
  n integer;
  avant jsonb;
  apres jsonb;
  email text := lower(btrim(coalesce(p_valeur, '')));
  cache_i text;
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

  -- Interrupteurs déclarés dans interrupteurs_gestion (oui ou non). Renvoie la valeur et le cache à vider.
  select i.cache into cache_i from interrupteurs_gestion i where i.cle = p_cle;
  if found then
    if p_valeur is null or p_valeur not in ('true', 'false') then
      raise exception 'Oui ou non';
    end if;
    select valeur into avant from reglages where cle = p_cle for update;
    if not found then
      raise exception 'Réglage inconnu';
    end if;
    update reglages set valeur = to_jsonb(p_valeur::boolean), proposition = false where cle = p_cle;
    perform journaliser(p_personnel, 'reglage', p_cle, avant, to_jsonb(p_valeur::boolean));
    return jsonb_build_object('valeur', p_valeur::boolean, 'cache', cache_i);
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
    'interrupteurs', (select coalesce(jsonb_agg(jsonb_build_object('cle', i.cle, 'libelle', i.libelle, 'aide', i.aide,
      'valeur', coalesce((select r.valeur = 'true'::jsonb from reglages r where r.cle = i.cle), false)) order by i.ordre, i.cle), '[]'::jsonb)
      from interrupteurs_gestion i where exists (select 1 from reglages r where r.cle = i.cle)),
    'rythme', (select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from reglages where cle in (
      'debit_pizza_quart_heure', 'debit_cuisine_quart_heure', 'allongement_max_minutes',
      'fourchette_livraison_minutes', 'fourchette_retrait_minutes'))
  );
$$;
