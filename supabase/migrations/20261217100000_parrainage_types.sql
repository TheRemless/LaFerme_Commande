-- Vague 3, client-compte : crédit du parrain et crédit du filleul sur deux types de mouvement distincts (mission compta
-- de bo-pilotage, docs/compta/plan-conformite.md R28 et R29). Jusqu'ici les deux portaient le type « parrainage » et
-- seul le motif les distinguait. La fiduciaire doit pouvoir traiter le crédit du parrain autrement (F13 : rabais, ou
-- rémunération en nature avec TVA sur le brut), sans relire les motifs.
--
-- Types de cagnotte_mouvements, à lire par les exports de bo-pilotage (20261217130000 et suivantes) :
-- - parrainage_parrain : crédit du parrain quand son proche a passé sa première commande, et sa reprise (négative) ;
-- - parrainage_filleul : crédit de bienvenue du filleul, et sa reprise (négative).
-- Les deux portent commande_id = la commande du filleul qui a déclenché le crédit. Le lien parrain et filleul est dans
-- parrainages (parrain_id, filleul_id, commande_id).
--
-- Objets recréés : crediter_parrainage et detecter_alertes_parrainage, parrainages_gestion (client-compte,
-- 20261217090000), reprendre_parrainage (20261216100000), rattraper_retraits (20261216190000). Seul le type change.

alter table cagnotte_mouvements drop constraint cagnotte_mouvements_type_check;

-- Mouvements déjà écrits : le parrain est celui du parrainage déclenché par la commande, le motif sert de secours.
update cagnotte_mouvements m set type = case
    when exists (select 1 from parrainages p where p.commande_id = m.commande_id and p.parrain_id = m.compte_id) then 'parrainage_parrain'
    when exists (select 1 from parrainages p where p.commande_id = m.commande_id and p.filleul_id = m.compte_id) then 'parrainage_filleul'
    when m.motif like 'Parrainage d''un proche%' then 'parrainage_parrain'
    else 'parrainage_filleul'
  end
  where m.type = 'parrainage';

alter table cagnotte_mouvements add constraint cagnotte_mouvements_type_check
  check (type in ('gain', 'utilise', 'rendu', 'retrait', 'expire', 'ajustement', 'parrainage_parrain', 'parrainage_filleul'));

create or replace function crediter_parrainage(p_commande uuid) returns text
language plpgsql as $$
declare
  o commandes%rowtype;
  p parrainages%rowtype;
  tels text[];
  adr text;
  montant integer := greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0);
  v_raison text;
begin
  select * into o from commandes where id = p_commande;
  if not found or o.statut <> 'terminee' or o.compte_id is null
     or o.motif is not distinct from 'Client absent à la livraison.' or not parrainage_actif() then
    return null;
  end if;
  select * into p from parrainages where filleul_id = o.compte_id and statut = 'en_attente' for update;
  if not found then
    return null;
  end if;
  -- Téléphones de la commande : le client et la personne qui reçoit (revue de sécurité).
  tels := array_remove(array[tel_cle(o.client_telephone), tel_cle(o.destinataire ->> 'telephone')], '');
  adr := case when o.mode = 'livraison' then adresse_cle(o.adresse) end;
  -- Pas encore encaissée (comptoir) : on attend l'encaissement, qui rappelle cette fonction. Remboursée : refus.
  if o.statut_paiement in ('a_encaisser_retrait', 'en_attente') then
    return null;
  end if;
  -- Parrain suspendu par le gérant : pas de nouveau crédit, ni pour lui ni pour le filleul. Les anciens restent.
  if exists (select 1 from parrains_suspendus s where s.parrain_id = p.parrain_id) then
    v_raison := 'parrain_suspendu';
  elsif o.statut_paiement not in ('paye', 'encaisse')
     or exists (select 1 from remboursements r where r.commande_id = o.id and r.statut in ('en_cours', 'fait')) then
    v_raison := 'paiement';
  elsif cardinality(tels) > 0 and (
       exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id
               and x.statut not in ('paiement_en_attente', 'annulee')
               and (tel_cle(x.client_telephone) = any(tels) or tel_cle(x.destinataire ->> 'telephone') = any(tels)))
       or exists (select 1 from comptes k where k.id = p.parrain_id and tel_cle(k.telephone) = any(tels))) then
    v_raison := 'telephone';
  elsif adr is not null and exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id and x.mode = 'livraison'
               and adresse_cle(x.adresse) = adr and x.statut not in ('paiement_en_attente', 'annulee')) then
    v_raison := 'adresse';
  end if;
  -- Sous le minimum de plats nets (relecture #260) : rien, le parrainage attend la commande suivante. Le rattachement
  -- n'est possible qu'avant toute commande (lier_parrainage), une commande suivante ne contourne donc rien.
  if v_raison is null and base_cagnotte(o) < parrainage_minimum() then
    return null;
  end if;
  if v_raison is not null then
    update parrainages set statut = 'refuse', raison = v_raison, commande_id = o.id, termine_le = now() where id = p.id;
    return v_raison;
  end if;
  update parrainages set statut = 'credite', commande_id = o.id, termine_le = now() where id = p.id;
  if montant > 0 then
    insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
      values (p.parrain_id, o.id, 'parrainage_parrain', montant, 'Parrainage d''un proche'),
             (o.compte_id, o.id, 'parrainage_filleul', montant, 'Bienvenue par parrainage');
  end if;
  return 'credite';
end;
$$;

create or replace function reprendre_parrainage(p_commande uuid) returns integer
language plpgsql as $$
declare
  m record;
  n integer := 0;
  r integer;
begin
  for m in select compte_id, type, sum(montant_centimes)::integer as total from cagnotte_mouvements
           where commande_id = p_commande and type in ('parrainage_parrain', 'parrainage_filleul')
           group by compte_id, type having sum(montant_centimes) > 0
  loop
    perform 1 from comptes where id = m.compte_id for update;
    r := least(m.total, greatest(solde_cagnotte(m.compte_id), 0));
    if r > 0 then
      insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
        values (m.compte_id, p_commande, m.type, -r, 'Parrainage repris, commande remboursée');
      n := n + 1;
    end if;
  end loop;
  update parrainages set statut = 'refuse', raison = 'rembourse', termine_le = now() where commande_id = p_commande and statut = 'credite';
  return n;
end;
$$;

create or replace function rattraper_retraits(p_compte uuid) returns integer
language plpgsql as $$
declare
  c record;
  n integer := 0;
begin
  for c in
    select distinct m.commande_id from cagnotte_mouvements m
    where m.compte_id = p_compte and m.type = 'gain'
      and exists (select 1 from remboursements r where r.commande_id = m.commande_id and r.statut = 'fait')
  loop
    if ajuster_gain(c.commande_id) < 0 then
      n := n + 1;
    end if;
  end loop;
  -- Parrainage repris au remboursement total (relecture #260) : ce qui n'a pas pu l'être faute de solde.
  for c in
    select m.commande_id from cagnotte_mouvements m
    where m.compte_id = p_compte and m.type in ('parrainage_parrain', 'parrainage_filleul')
      and exists (select 1 from parrainages p where p.commande_id = m.commande_id and p.statut = 'refuse' and p.raison = 'rembourse')
    group by m.commande_id having sum(m.montant_centimes) > 0
  loop
    if reprendre_parrainage(c.commande_id) > 0 then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function detecter_alertes_parrainage() returns jsonb
language plpgsql as $$
declare
  seuil_filleuls integer := greatest(fidelite_entier('parrainage_alerte_filleuls_30j', 3), 1);
  min_suite integer := greatest(fidelite_entier('parrainage_alerte_sans_suite_min', 3), 1);
  pct_suite integer := least(greatest(fidelite_entier('parrainage_alerte_sans_suite_pourcent', 75), 1), 100);
  mois text := to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM');
begin
  -- Trop de filleuls crédités en 30 jours.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'trop_de_filleuls:' || p.parrain_id || ':' || mois, p.parrain_id, 'trop_de_filleuls', jsonb_build_object('filleuls_30j', count(*), 'seuil', seuil_filleuls)
  from parrainages p where p.statut = 'credite' and p.termine_le >= now() - interval '30 days'
  group by p.parrain_id having count(*) > seuil_filleuls
  on conflict (cle) do nothing;

  -- Filleuls d'un même parrain à la même adresse de livraison.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'meme_adresse:' || x.parrain_id || ':' || md5(x.adr), x.parrain_id, 'meme_adresse', jsonb_build_object('filleuls', x.n)
  from (
    select p.parrain_id, adresse_cle(o.adresse) as adr, count(distinct p.filleul_id) as n
    from parrainages p join commandes o on o.compte_id = p.filleul_id and o.mode = 'livraison'
    where o.statut not in ('paiement_en_attente', 'annulee') and adresse_cle(o.adresse) is not null
    group by p.parrain_id, adresse_cle(o.adresse) having count(distinct p.filleul_id) >= 2
  ) x
  on conflict (cle) do nothing;

  -- Filleuls d'un même parrain connectés depuis la même adresse IP (extrait chiffré du journal des connexions).
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'meme_ip:' || x.parrain_id || ':' || x.ip_court, x.parrain_id, 'meme_ip', jsonb_build_object('filleuls', x.n)
  from (
    select p.parrain_id, j.ip_court, count(distinct p.filleul_id) as n
    from parrainages p join journal_connexions j on j.compte_id = p.filleul_id
    where j.ip_court is not null and j.ip_court <> ''
    group by p.parrain_id, j.ip_court having count(distinct p.filleul_id) >= 2
  ) x
  on conflict (cle) do nothing;

  -- Filleuls d'un même parrain au même nom (compte ou commande).
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'meme_nom:' || x.parrain_id || ':' || md5(x.nom), x.parrain_id, 'meme_nom', jsonb_build_object('filleuls', x.n)
  from (
    select y.parrain_id, y.nom, count(distinct y.filleul_id) as n
    from (
      select p.parrain_id, p.filleul_id, nom_cle(o.client_prenom, o.client_nom) as nom
      from parrainages p join commandes o on o.compte_id = p.filleul_id
      union
      select p.parrain_id, p.filleul_id, nom_cle(k.prenom, k.nom)
      from parrainages p join comptes k on k.id = p.filleul_id
    ) y
    where length(y.nom) >= 3
    group by y.parrain_id, y.nom having count(distinct y.filleul_id) >= 2
  ) x
  on conflict (cle) do nothing;

  -- Filleuls crédités depuis plus de 30 jours qui n'ont jamais recommandé.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'sans_suite:' || x.parrain_id || ':' || mois, x.parrain_id, 'sans_suite',
         jsonb_build_object('filleuls', x.total, 'sans_suite', x.sans_suite, 'pourcent', round(100.0 * x.sans_suite / x.total))
  from (
    select p.parrain_id, count(*) as total,
           count(*) filter (where (select count(*) from commandes o where o.compte_id = p.filleul_id and o.statut = 'terminee') < 2) as sans_suite
    from parrainages p where p.statut = 'credite' and p.termine_le < now() - interval '30 days'
    group by p.parrain_id
  ) x
  where x.total >= min_suite and 100 * x.sans_suite >= pct_suite * x.total
  on conflict (cle) do nothing;

  -- Compte qui a reçu plus en parrainage qu'il n'a payé sur 30 jours.
  insert into alertes_parrainage (cle, compte_id, type, detail)
  select 'recu_plus_que_paye:' || x.compte_id || ':' || mois, x.compte_id, 'recu_plus_que_paye',
         jsonb_build_object('recu_centimes', x.recu, 'paye_centimes', x.paye)
  from (
    select m.compte_id, sum(m.montant_centimes)::integer as recu,
           coalesce((select sum(o.total_centimes) from commandes o where o.compte_id = m.compte_id and o.statut = 'terminee'
                     and o.statut_paiement in ('paye', 'encaisse') and o.cree_le >= now() - interval '30 days'), 0)::integer as paye
    from cagnotte_mouvements m where m.type in ('parrainage_parrain', 'parrainage_filleul') and m.cree_le >= now() - interval '30 days'
    group by m.compte_id
  ) x
  where x.recu > x.paye
  on conflict (cle) do nothing;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'compte_id', a.compte_id, 'detail', a.detail) order by a.id)
    from alertes_parrainage a where a.envoye_le is null
  ), '[]'::jsonb);
end;
$$;

create or replace function parrainages_gestion() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.ligne order by x.ouverts desc, x.dernier desc), '[]'::jsonb)
  from (
    select
      (select count(*) from alertes_parrainage a where a.classee_le is null
         and (a.compte_id = k.id or a.compte_id in (select filleul_id from parrainages where parrain_id = k.id))) as ouverts,
      (select max(cree_le) from parrainages where parrain_id = k.id) as dernier,
      jsonb_build_object(
        'parrain_id', k.id,
        'email', k.email,
        'prenom', k.prenom,
        'nom', k.nom,
        'suspendu', (select jsonb_build_object('motif', s.motif, 'par', s.par, 'le', s.le) from parrains_suspendus s where s.parrain_id = k.id),
        'filleuls', coalesce((
          select jsonb_agg(jsonb_build_object(
            'email', f.email, 'prenom', f.prenom, 'nom', f.nom, 'lie_le', p.cree_le, 'statut', p.statut, 'raison', p.raison,
            'termine_le', p.termine_le,
            'montant_centimes', coalesce((select sum(m.montant_centimes) from cagnotte_mouvements m
                                          where m.compte_id = f.id and m.type = 'parrainage_filleul'), 0)
          ) order by p.cree_le)
          from parrainages p join comptes f on f.id = p.filleul_id where p.parrain_id = k.id
        ), '[]'::jsonb),
        'signaux', coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'detail', a.detail, 'le', a.cree_le,
            'classee_le', a.classee_le, 'filleul', a.compte_id <> k.id) order by a.cree_le desc)
          from alertes_parrainage a
          where a.compte_id = k.id or a.compte_id in (select filleul_id from parrainages where parrain_id = k.id)
        ), '[]'::jsonb)
      ) as ligne
    from comptes k
    where exists (select 1 from parrainages p where p.parrain_id = k.id)
  ) x;
$$;
