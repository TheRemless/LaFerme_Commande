-- Vague 3, pilotage : clôture du jour (rapport Z). Un jour de service, de 5h à 5h le lendemain (heure de
-- Genève) : ce qui a été vendu et encaissé, ce qui reste à encaisser au comptoir, les remboursements, les
-- écarts à vérifier et la TVA par taux. Le gérant clôture en notant ce qu'il a compté au comptoir (espèces,
-- et le ticket de clôture du terminal de carte s'il y en a un) : la base calcule l'écart avec l'attendu.
-- Clôturer est journalisé ; reclôturer le même jour remplace la clôture et garde l'ancienne dans le journal.
--
-- Aucune donnée personnelle de client : numéros de commande, montants, statuts et motifs seulement.

create table clotures (
  jour date primary key,
  -- null : pas compté (journée sans comptoir, ou terminal sans ticket de clôture).
  especes_comptees_centimes integer check (especes_comptees_centimes between 0 and 100000000),
  carte_comptoir_centimes integer check (carte_comptoir_centimes between 0 and 100000000),
  attendu_comptoir_centimes integer not null,
  ecart_centimes integer,
  note text not null default '' check (length(note) <= 300),
  -- Le rapport tel qu'il était au moment de clôturer : il ne bouge plus si une commande change ensuite.
  rapport jsonb not null,
  personnel_id uuid references personnel (id) on delete set null,
  personnel_nom text not null,
  cloture_le timestamptz not null default now()
);
alter table clotures enable row level security;
revoke all on clotures from anon, authenticated;
grant select, insert, update on clotures to service_role;

create function cloture_rapport(p_jour date) returns jsonb
language sql stable as $$
  with bornes as (
    select (p_jour + time '05:00') at time zone 'Europe/Zurich' as debut,
           (p_jour + 1 + time '05:00') at time zone 'Europe/Zurich' as fin
  ),
  jour as (
    select o.* from commandes o
    where o.jour_service = p_jour and o.statut not in ('paiement_en_attente', 'annulee')
  ),
  -- Ce que le client a eu en moins sur une commande pas encore payée au comptoir (manque déduit).
  deductions as (
    select r.commande_id, sum(r.montant_centimes)::bigint as montant
    from remboursements r join jour o on o.id = r.commande_id
    where r.moyen = 'deduction' and r.statut = 'fait'
    group by r.commande_id
  ),
  comptoir as (
    select o.id, o.total_centimes - coalesce(d.montant, 0) as encaisse
    from jour o left join deductions d on d.commande_id = o.id
    where o.moyen_paiement = 'comptoir' and o.statut <> 'refusee' and o.statut_paiement in ('encaisse', 'rembourse')
  ),
  rembs as (
    select r.*, o.numero, o.statut as statut_commande, o.moyen_paiement
    from remboursements r join commandes o on o.id = r.commande_id, bornes b
    where (r.statut = 'fait' and r.fait_le >= b.debut and r.fait_le < b.fin)
       or (r.statut <> 'fait' and r.cree_le >= b.debut and r.cree_le < b.fin)
  ),
  especes_rendues as (
    select coalesce(sum(montant_centimes), 0)::bigint as montant from rembs where moyen = 'especes' and statut = 'fait'
  )
  select jsonb_build_object(
    'jour', p_jour,
    'debut', (select debut from bornes),
    'fin', (select fin from bornes),
    'calcule_le', now(),
    'ventes', pilotage_synthese(p_jour, p_jour),
    'encaissements', jsonb_build_object(
      'en_ligne', (
        select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(total_centimes), 0))
        from jour where moyen_paiement = 'en_ligne' and statut <> 'refusee' and statut_paiement in ('paye', 'rembourse')
      ),
      'comptoir', (select jsonb_build_object('commandes', count(*), 'centimes', coalesce(sum(encaisse), 0)) from comptoir),
      'deductions_centimes', (select coalesce(sum(montant), 0) from deductions),
      'especes_rendues_centimes', (select montant from especes_rendues),
      'attendu_comptoir_centimes', (select coalesce(sum(encaisse), 0) from comptoir) - (select montant from especes_rendues)
    ),
    'a_encaisser', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', o.numero, 'mode', o.mode, 'statut', o.statut,
        'du_centimes', o.total_centimes - coalesce(d.montant, 0),
        'heure', to_char(coalesce(o.heure_confirmee, o.cree_le) at time zone 'Europe/Zurich', 'HH24:MI')
      ) order by o.numero)
      from jour o left join deductions d on d.commande_id = o.id
      where o.statut_paiement = 'a_encaisser_retrait' and o.statut <> 'refusee'
    ), '[]'::jsonb),
    'remboursements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', numero, 'montant_centimes', montant_centimes, 'moyen', moyen, 'statut', statut, 'motif', motif,
        'par', personnel_nom, 'commande_refusee', statut_commande = 'refusee', 'erreur', erreur,
        'heure', to_char(coalesce(fait_le, cree_le) at time zone 'Europe/Zurich', 'HH24:MI')
      ) order by coalesce(fait_le, cree_le))
      from rembs
    ), '[]'::jsonb),
    'ecarts', coalesce((
      select jsonb_agg(e.j order by e.ordre, e.numero) from (
        select 1 as ordre, o.numero, jsonb_build_object('type', 'remise_sans_encaissement', 'numero', o.numero,
          'centimes', o.total_centimes - coalesce(d.montant, 0)) as j
        from jour o left join deductions d on d.commande_id = o.id
        where o.statut = 'terminee' and o.statut_paiement = 'a_encaisser_retrait'
        union all
        select 2, numero, jsonb_build_object('type', 'remboursement_' || statut, 'numero', numero, 'centimes', montant_centimes)
        from rembs where statut in ('echec', 'en_cours')
        union all
        select 3, o.numero, jsonb_build_object('type', 'pas_terminee', 'numero', o.numero, 'statut', o.statut, 'centimes', o.total_centimes)
        from jour o where o.statut in ('nouvelle', 'acceptee', 'en_preparation', 'prete', 'partie')
      ) e
    ), '[]'::jsonb)
  );
$$;

-- Jour clôturé : le rapport enregistré, la clôture (sans le rapport, une seule copie) et change_depuis,
-- vrai si le rapport calculé maintenant n'est plus le même (commande encaissée, remboursement confirmé…).
-- Jour pas clôturé : le rapport calculé maintenant.
create function cloture_jour(p_jour date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'rapport', coalesce(c.rapport, x.actuel),
    'cloture', to_jsonb(c) - 'personnel_id' - 'rapport',
    'change_depuis', c.jour is not null and (c.rapport - 'calcule_le') is distinct from (x.actuel - 'calcule_le')
  )
  from (select cloture_rapport(p_jour) as actuel) x
  left join clotures c on c.jour = p_jour;
$$;

create function cloturer_jour(p_jour date, p_especes integer, p_carte integer, p_note text, p_personnel uuid) returns jsonb
language plpgsql as $$
declare
  auteur text := gerant_nom(p_personnel);
  aujourd_hui date := ((now() at time zone 'Europe/Zurich') - interval '5 hours')::date;
  r jsonb;
  attendu integer;
  avant clotures%rowtype;
  apres clotures%rowtype;
  n text := btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g'));
begin
  if p_jour is null or p_jour > aujourd_hui or p_jour < aujourd_hui - 366 then
    raise exception 'jour_invalide';
  end if;
  if (p_especes is not null and p_especes not between 0 and 100000000) or (p_carte is not null and p_carte not between 0 and 100000000) then
    raise exception 'montant_invalide';
  end if;
  if length(n) > 300 then
    raise exception 'note_trop_longue';
  end if;
  -- Deux gérants qui clôturent en même temps : le second attend le premier, puis remplace sa clôture.
  perform pg_advisory_xact_lock(hashtext('cloture:' || p_jour::text));
  select * into avant from clotures where jour = p_jour;
  r := cloture_rapport(p_jour);
  attendu := (r -> 'encaissements' ->> 'attendu_comptoir_centimes')::integer;
  insert into clotures (jour, especes_comptees_centimes, carte_comptoir_centimes, attendu_comptoir_centimes, ecart_centimes, note,
    rapport, personnel_id, personnel_nom, cloture_le)
  values (p_jour, p_especes, p_carte, attendu,
    case when p_especes is null and p_carte is null then null else coalesce(p_especes, 0) + coalesce(p_carte, 0) - attendu end,
    n, r, p_personnel, auteur, now())
  on conflict (jour) do update set
    especes_comptees_centimes = excluded.especes_comptees_centimes, carte_comptoir_centimes = excluded.carte_comptoir_centimes,
    attendu_comptoir_centimes = excluded.attendu_comptoir_centimes, ecart_centimes = excluded.ecart_centimes, note = excluded.note,
    rapport = excluded.rapport, personnel_id = excluded.personnel_id, personnel_nom = excluded.personnel_nom, cloture_le = excluded.cloture_le
  returning * into apres;
  -- Le journal garde les montants comptés et l'écart, pas le rapport entier (il est dans la table).
  perform journaliser(p_personnel, 'cloture', p_jour::text,
    case when avant.jour is null then null else to_jsonb(avant) - 'rapport' - 'personnel_id' end,
    to_jsonb(apres) - 'rapport' - 'personnel_id');
  return to_jsonb(apres) - 'personnel_id';
end;
$$;

revoke execute on function cloture_rapport(date), cloture_jour(date), cloturer_jour(date, integer, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function cloture_rapport(date), cloture_jour(date), cloturer_jour(date, integer, integer, text, uuid)
  to service_role;
