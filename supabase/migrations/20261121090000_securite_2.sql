-- Passe de sécurité finale de la vague 2 (docs/audits/securite-2.md, constats S2-05, S2-06, S2-07 et S2-08).
-- Objets partagés recréés depuis leur dernière définition (20261119090000_livreurs.sql), avec seulement
-- les changements ci-dessous : geste_livreur et modifier_personnel. Même signature : `create or replace`
-- garde les droits (exécution réservée à service_role). Aucun UPDATE ni DELETE sur des données.

-- ---------- S2-05 et S2-06 : gestes du livreur ----------
-- 1. « Compris » ne vaut que pour une livraison de ce livreur : avant, n'importe quelle commande connue
--    répondait « ok » et le journal de livraison de cette commande portait son nom.
-- 2. « Problème » ne vaut que sur une livraison en cours (acceptée, en préparation ou partie) : avant, il
--    s'écrivait encore après « Livrée » ou sur une commande close.
-- 3. Un geste rejoué sans effet (« Je pars » déjà parti, « Livrée » déjà livrée) répond toujours « ok »
--    mais n'ajoute plus de ligne au journal.
-- 4. Verrous dans le même ordre que la tablette (commande, puis livraison) : une réattribution au moment
--    où le livreur appuie sur « Livrée » ne peut plus finir en interblocage.
create or replace function geste_livreur(p_cle text, p_livreur uuid, p_commande uuid, p_geste text, p_motif text default null, p_detail text default null)
returns jsonb
language plpgsql as $$
declare
  avant gestes_livreur%rowtype;
  l livraisons%rowtype;
  st text;
  par text;
  d text := nullif(btrim(regexp_replace(coalesce(p_detail, ''), '\s+', ' ', 'g')), '');
  r jsonb;
  noter boolean := true;
begin
  perform pg_advisory_xact_lock(hashtext('geste:' || p_cle));
  select * into avant from gestes_livreur where cle = p_cle;
  if found then
    if avant.livreur_id <> p_livreur or avant.commande_id <> p_commande or avant.geste <> p_geste then
      return jsonb_build_object('ok', false, 'raison', 'cle');
    end if;
    return avant.resultat || jsonb_build_object('deja', true, 'prevenir', false);
  end if;
  -- La route l'a déjà vérifié ; la base le revérifie : seul un livreur actif fait un geste.
  select 'livreur:' || nom into par from personnel where id = p_livreur and role = 'livreur' and actif;
  if p_geste not in ('partie', 'livree', 'probleme', 'compris') or par is null then
    return jsonb_build_object('ok', false, 'raison', 'geste');
  end if;
  -- Commande d'abord, livraison ensuite : même ordre que attribuer_livraison et clore_client_absent.
  select statut into st from commandes where id = p_commande for update;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
  end if;

  if p_geste = 'compris' then
    update livraisons set retrait_vu_le = now(),
      retiree_le = coalesce(retiree_le, now()),
      raison_retrait = coalesce(raison_retrait, 'annulee')
    where id = (
      select x.id from livraisons x join commandes o on o.id = x.commande_id
      where x.commande_id = p_commande and x.livreur_id = p_livreur and x.retrait_vu_le is null
        and (x.retiree_le is not null or o.statut in ('refusee', 'annulee'))
      order by x.attribuee_le desc limit 1
    );
    if found then
      r := jsonb_build_object('ok', true, 'prevenir', false);
    elsif exists (select 1 from livraisons where commande_id = p_commande and livreur_id = p_livreur) then
      -- Déjà lu (second appui avec une autre clé) : rien à changer, rien à noter.
      r := jsonb_build_object('ok', true, 'prevenir', false);
      noter := false;
    else
      r := jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
    end if;
  else
    select * into l from livraisons where commande_id = p_commande and retiree_le is null for update;
    if l.id is null or l.livreur_id <> p_livreur then
      r := jsonb_build_object('ok', false, 'raison', 'pas_a_vous');
    elsif st in ('refusee', 'annulee') then
      r := jsonb_build_object('ok', false, 'raison', 'annulee');
    elsif p_geste = 'partie' then
      if st = 'partie' then
        r := jsonb_build_object('ok', true, 'prevenir', false);
        noter := false;
      elsif st in ('acceptee', 'en_preparation') and changer_statut(p_commande, 'partie', par, null, null, st) then
        r := jsonb_build_object('ok', true, 'prevenir', true);
      else
        r := jsonb_build_object('ok', false, 'raison', 'statut');
      end if;
    elsif p_geste = 'livree' then
      -- « Livrée » sans « Je pars » avant : on passe par « partie » sans e-mail au client.
      if st in ('acceptee', 'en_preparation') then
        perform changer_statut(p_commande, 'partie', par, null, null, st);
        st := 'partie';
      end if;
      if st = 'partie' and changer_statut(p_commande, 'terminee', par, null, null, 'partie') then
        update livraisons set probleme = null, probleme_detail = null, probleme_le = null where id = l.id;
        r := jsonb_build_object('ok', true, 'prevenir', false);
      elsif st = 'terminee' then
        r := jsonb_build_object('ok', true, 'prevenir', false);
        noter := false;
      else
        r := jsonb_build_object('ok', false, 'raison', 'statut');
      end if;
    elsif st not in ('acceptee', 'en_preparation', 'partie') then
      r := jsonb_build_object('ok', false, 'raison', 'statut');
    else
      if p_motif is null or p_motif not in ('client_absent', 'adresse_introuvable', 'autre') then
        return jsonb_build_object('ok', false, 'raison', 'motif');
      end if;
      if p_motif = 'autre' and d is null then
        return jsonb_build_object('ok', false, 'raison', 'detail');
      end if;
      if length(d) > 200 then
        d := left(d, 200);
      end if;
      update livraisons set probleme = p_motif, probleme_detail = d, probleme_le = now() where id = l.id;
      r := jsonb_build_object('ok', true, 'prevenir', false);
    end if;
  end if;

  if (r ->> 'ok')::boolean and noter then
    insert into journal_livraisons (commande_id, personnel_id, par, evenement, detail)
    values (p_commande, p_livreur, par, p_geste, case when p_geste = 'probleme' then p_motif || coalesce(' : ' || d, '') end);
  end if;
  insert into gestes_livreur (cle, livreur_id, commande_id, geste, resultat) values (p_cle, p_livreur, p_commande, p_geste, r);
  return r;
end;
$$;

-- ---------- S2-07 : gérant retiré pendant son propre geste ----------
-- Le contrôle du gérant se faisait avant le verrou sur les gérants. Si A retire B au moment où B nomme un
-- autre gérant, l'appel de B attendait la fin de celui de A puis passait quand même. On revérifie après le verrou.
create or replace function modifier_personnel(p_id uuid, p jsonb, p_personnel uuid) returns boolean
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  avant personnel%rowtype;
  apres personnel%rowtype;
  n text;
begin
  -- Verrou sur les gérants actifs : deux retraits simultanés ne laissent pas la maison sans gérant.
  perform 1 from personnel where role = 'gerant' and actif for update;
  -- Toujours gérant une fois le verrou obtenu (lecture fraîche après l'attente).
  auteur := gerant_nom(p_personnel);
  select * into avant from personnel where id = p_id for update;
  if not found then
    return false;
  end if;
  apres := avant;
  if p ? 'nom' then
    n := btrim(regexp_replace(coalesce(p ->> 'nom', ''), '\s+', ' ', 'g'));
    if length(n) not between 1 and 60 then
      raise exception 'nom_invalide';
    end if;
    apres.nom := n;
  end if;
  if p ? 'role' then
    if p ->> 'role' not in ('service', 'gerant', 'livreur') then
      raise exception 'role_invalide';
    end if;
    apres.role := p ->> 'role';
  end if;
  if p ? 'actif' then
    apres.actif := (p ->> 'actif')::boolean;
  end if;
  if avant.role = 'gerant' and avant.actif and not (apres.role = 'gerant' and apres.actif)
     and (select count(*) from personnel where role = 'gerant' and actif) <= 1 then
    raise exception 'dernier_gerant';
  end if;
  update personnel set nom = apres.nom, role = apres.role, actif = apres.actif where id = p_id;
  if not apres.actif then
    update sessions_personnel set revoquee_le = now() where personnel_id = p_id and revoquee_le is null;
  end if;
  insert into journal_gestion (personnel_id, personnel_nom, objet, cle, avant, apres)
  values (p_personnel, auteur, 'personnel', avant.email,
    jsonb_build_object('nom', avant.nom, 'role', avant.role, 'actif', avant.actif),
    jsonb_build_object('nom', apres.nom, 'role', apres.role, 'actif', apres.actif));
  return true;
end;
$$;

-- ---------- S2-08 : vues publiques en lecture seule ----------
-- Supabase donne par défaut tous les droits à anon et authenticated sur une vue neuve. Le correctif S8
-- (20261112090000) les avait retirés sur les tables, pas sur ces quatre vues. Sans effet aujourd'hui
-- (security_invoker : les droits des tables s'appliquent), mais une vue ne doit rien promettre de plus.
revoke insert, update, delete, truncate, references, trigger on
  carte_publique, options_publiques, plat_groupes_publics, retraits_publics
  from anon, authenticated;
