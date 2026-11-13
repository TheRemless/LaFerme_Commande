-- Coup de feu (vague 3, bo-operations) : en un geste depuis la tablette ou le back-office, un soir chargé,
-- plus de retard sur les heures annoncées, moins de commandes par créneau, livraison fermée au choix. Tout
-- revient seul à l'heure choisie (surveillance, chaque minute) ou d'un geste « Fin du coup de feu ».
--
-- Pas de fonction partagée recréée : le coup de feu écrit les réglages que lisent déjà le site et la base
-- (retard_minutes, livraison_fermee, capacite_livraisons_par_creneau, capacite_retraits_par_creneau). Il
-- garde leurs valeurs d'avant et ne les rend qu'aux réglages que personne n'a changés entre-temps : un
-- gérant qui règle la capacité pendant le coup de feu garde sa valeur.
--
-- La table reglages est lisible par tous : l'état n'y contient aucun nom. Qui a lancé le coup de feu est
-- dans journal_gestion.

-- null : pas de coup de feu. Sinon { debut, jusqua, applique: {cle: valeur}, avant: {cle: valeur} }.
insert into reglages (cle, valeur, proposition) values ('coup_de_feu', 'null', false)
  on conflict (cle) do nothing;

-- Valeurs proposées du geste, à valider par Jérémy (proposition) : 20 minutes de retard, une heure,
-- 2 livraisons et 2 retraits par créneau (la moitié de 3 et 4, arrondie au-dessus), livraison ouverte.
insert into reglages (cle, valeur, proposition) values
  ('coup_de_feu_defaut', '{"retard_minutes": 20, "duree_minutes": 60, "capacite_livraison": 2, "capacite_retrait": 2, "livraison_fermee": false}', true)
  on conflict (cle) do nothing;

-- Équipe du restaurant (tablette et back-office), pas les livreurs. Renvoie le prénom.
create function equipe_nom(p_personnel uuid) returns text
language plpgsql stable as $$
declare
  n text;
begin
  select nom into n from personnel where id = p_personnel and actif and role in ('service', 'gerant');
  if n is null then
    raise exception 'Réservé à l''équipe du restaurant';
  end if;
  return n;
end;
$$;

-- Rend aux réglages appliqués leur valeur d'avant, seulement s'ils n'ont pas changé depuis.
create function coup_de_feu_rendre(e jsonb) returns jsonb
language plpgsql as $$
declare
  k text;
  rendus text[] := '{}';
  gardes text[] := '{}';
begin
  for k in select jsonb_object_keys(coalesce(e -> 'applique', '{}'::jsonb)) loop
    update reglages set valeur = e -> 'avant' -> k
      where cle = k and valeur = e -> 'applique' -> k and (e -> 'avant') ? k;
    if found then
      rendus := rendus || k;
    else
      gardes := gardes || k;
    end if;
  end loop;
  return jsonb_build_object('rendus', to_jsonb(rendus), 'gardes', to_jsonb(gardes));
end;
$$;

-- p : { retard_minutes (0 à 90), duree_minutes (15 à 360), livraison_fermee (booléen),
--       capacite_livraison, capacite_retrait (1 à 50, ou absents : capacité inchangée) }.
-- Le retard et la capacité ne font que durcir : un retard déjà plus long reste, une capacité déjà plus
-- basse reste. Relancer pendant un coup de feu le remplace (mêmes valeurs d'avant, même début).
create function lancer_coup_de_feu(p jsonb, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := equipe_nom(p_personnel);
  actuel jsonb;
  debut timestamptz := now();
  retard integer;
  duree integer;
  fermee boolean;
  cap_l integer;
  cap_r integer;
  cur integer;
  applique jsonb := '{}'::jsonb;
  avant jsonb;
  etat jsonb;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception 'Réglages du coup de feu illisibles';
  end if;
  retard := coalesce((p ->> 'retard_minutes')::integer, 0);
  duree := (p ->> 'duree_minutes')::integer;
  fermee := coalesce((p ->> 'livraison_fermee')::boolean, false);
  cap_l := (p ->> 'capacite_livraison')::integer;
  cap_r := (p ->> 'capacite_retrait')::integer;
  if retard not between 0 and 90 then
    raise exception 'Retard entre 0 et 90 minutes';
  end if;
  if duree is null or duree not between 15 and 360 then
    raise exception 'Durée entre 15 minutes et 6 heures';
  end if;
  if (cap_l is not null and cap_l not between 1 and 50) or (cap_r is not null and cap_r not between 1 and 50) then
    raise exception 'Capacité entre 1 et 50';
  end if;
  if retard = 0 and not fermee and cap_l is null and cap_r is null then
    raise exception 'Rien à changer';
  end if;

  select valeur into actuel from reglages where cle = 'coup_de_feu' for update;
  -- Un coup de feu dont l'heure est passée (surveillance pas encore passée) est fini d'abord : le nouveau
  -- repart de maintenant.
  if jsonb_typeof(actuel) = 'object' and (actuel ->> 'jusqua')::timestamptz <= now() then
    perform finir_coup_de_feu(null);
    actuel := 'null'::jsonb;
  end if;
  if jsonb_typeof(actuel) = 'object' then
    perform coup_de_feu_rendre(actuel);
    debut := (actuel ->> 'debut')::timestamptz;
  end if;

  if retard > 0 then
    cur := coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'retard_minutes'), 0);
    applique := applique || jsonb_build_object('retard_minutes', greatest(cur, retard));
  end if;
  if fermee then
    applique := applique || jsonb_build_object('livraison_fermee', true);
  end if;
  if cap_l is not null then
    cur := coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'capacite_livraisons_par_creneau'), 0);
    applique := applique || jsonb_build_object('capacite_livraisons_par_creneau', case when cur = 0 then cap_l else least(cur, cap_l) end);
  end if;
  if cap_r is not null then
    cur := coalesce((select (valeur #>> '{}')::integer from reglages where cle = 'capacite_retraits_par_creneau'), 0);
    applique := applique || jsonb_build_object('capacite_retraits_par_creneau', case when cur = 0 then cap_r else least(cur, cap_r) end);
  end if;

  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) into avant
    from reglages where cle in (select jsonb_object_keys(applique));
  update reglages r set valeur = applique -> r.cle where r.cle in (select jsonb_object_keys(applique));

  etat := jsonb_build_object('debut', debut, 'jusqua', now() + make_interval(mins => duree), 'applique', applique, 'avant', avant);
  update reglages set valeur = etat where cle = 'coup_de_feu';
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'coup_de_feu', 'lancer', case when jsonb_typeof(actuel) = 'object' then actuel end, etat);
  return etat;
end;
$$;

-- Fin d'un geste (p_personnel) ou à l'heure dite (p_personnel null, surveillance). null : pas de coup de feu.
create function finir_coup_de_feu(p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  qui text := case when p_personnel is null then 'Fin automatique' else equipe_nom(p_personnel) end;
  actuel jsonb;
  r jsonb;
begin
  select valeur into actuel from reglages where cle = 'coup_de_feu' for update;
  if jsonb_typeof(actuel) is distinct from 'object' then
    return null;
  end if;
  r := coup_de_feu_rendre(actuel);
  update reglages set valeur = 'null'::jsonb where cle = 'coup_de_feu';
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
    values (p_personnel, qui, 'coup_de_feu', 'finir', actuel, r);
  return r;
end;
$$;

-- Appelée par la surveillance chaque minute : finit le coup de feu dont l'heure est passée.
create function fin_coup_de_feu_echue() returns jsonb
language plpgsql as $$
declare
  v jsonb := (select valeur from reglages where cle = 'coup_de_feu');
begin
  if jsonb_typeof(v) = 'object' and (v ->> 'jusqua')::timestamptz <= now() then
    return finir_coup_de_feu(null);
  end if;
  return null;
end;
$$;

-- État pour la tablette et le back-office : le coup de feu en cours (avec qui l'a lancé), les valeurs
-- proposées du geste et les réglages actuels.
create function etat_coup_de_feu() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'en_cours', case when jsonb_typeof(c.valeur) = 'object' then c.valeur || jsonb_build_object('par', (
      select j.personnel_nom from journal_gestion j where j.objet = 'coup_de_feu' and j.cle = 'lancer' order by j.le desc, j.id desc limit 1
    )) end,
    'defaut', (select valeur from reglages where cle = 'coup_de_feu_defaut'),
    'defaut_propose', coalesce((select proposition from reglages where cle = 'coup_de_feu_defaut'), true),
    'actuel', (select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from reglages
      where cle in ('retard_minutes', 'livraison_fermee', 'capacite_livraisons_par_creneau', 'capacite_retraits_par_creneau'))
  )
  from (select (select valeur from reglages where cle = 'coup_de_feu') as valeur) c;
$$;

-- Index pour le prénom du dernier lancement (journal long après des mois de service).
create index journal_gestion_objet_idx on journal_gestion (objet, cle, le desc);

revoke execute on function
  equipe_nom(uuid), coup_de_feu_rendre(jsonb), lancer_coup_de_feu(jsonb, uuid), finir_coup_de_feu(uuid),
  fin_coup_de_feu_echue(), etat_coup_de_feu()
  from public, anon, authenticated;
grant execute on function
  equipe_nom(uuid), coup_de_feu_rendre(jsonb), lancer_coup_de_feu(jsonb, uuid), finir_coup_de_feu(uuid),
  fin_coup_de_feu_echue(), etat_coup_de_feu()
  to service_role;
