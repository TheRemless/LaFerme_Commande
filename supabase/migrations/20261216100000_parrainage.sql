-- Vague 3, client-compte : parrainage (programme de fidélité validé par Jérémy le 15.11.2026). Sous l'interrupteur de la
-- cagnotte (fidelite_active), construit éteint.
--
-- Règles :
-- - chaque compte a un lien personnel /parrain/<code> (le code seul, aucune donnée du client) ;
-- - un filleul est un nouveau compte : son e-mail n'a jamais commandé ni eu de compte ; un seul parrain ; pas
--   d'auto-parrainage ; au plus N parrainages par compte et par mois (10, réglable) ;
-- - CHF 10 (réglable) au parrain et au filleul, crédités dans leur cagnotte après la première commande livrée ou
--   retirée du filleul. À ce moment, la base revérifie que le téléphone et l'adresse de livraison de cette commande
--   n'ont jamais été vus (ni chez le parrain, ni dans une autre commande) : sinon le parrainage est refusé, sans
--   crédit. Même normalisation que la « première commande » des codes promo (telephone_normal, adresse_cle).
--
-- Objet recréé : cagnotte_au_statut (20261216090000_cagnotte.sql, client-compte) avec l'appel au parrainage.
-- Ajouts sur des tables partagées : comptes.code_parrainage, deux réglages.

insert into reglages (cle, valeur, proposition) values
  ('parrainage_montant_centimes', '1000', false),
  ('parrainage_plafond_mois', '10', false)
  on conflict (cle) do nothing;

alter table comptes add column code_parrainage text unique check (code_parrainage ~ '^[A-HJ-NP-Z2-9]{8}$');

create table parrainages (
  id uuid primary key default gen_random_uuid(),
  parrain_id uuid not null references comptes (id) on delete cascade,
  filleul_id uuid not null unique references comptes (id) on delete cascade,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'credite', 'refuse')),
  raison text,
  commande_id uuid references commandes (id) on delete set null,
  cree_le timestamptz not null default now(),
  termine_le timestamptz
);
create index parrainages_parrain_idx on parrainages (parrain_id, cree_le);
alter table parrainages enable row level security;
revoke all on parrainages from anon, authenticated;
grant select, insert, update on parrainages to service_role;

-- Code personnel, créé au premier besoin : 8 caractères sans 0, O, 1 ni I.
create function code_parrainage(p_compte uuid) returns text
language plpgsql as $$
declare
  c text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select code_parrainage into c from comptes where id = p_compte;
  if c is not null then
    return c;
  end if;
  loop
    c := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1), '') from generate_series(1, 8));
    begin
      update comptes set code_parrainage = c where id = p_compte and code_parrainage is null;
      return (select code_parrainage from comptes where id = p_compte);
    exception when unique_violation then
      -- Code déjà pris : on en tire un autre.
    end;
  end loop;
end;
$$;

-- Rattache un compte qui vient d'être créé à son parrain. Rend 'ok' ou la raison du refus : desactive, code,
-- soi_meme, deja, ancien (compte de plus de 24 heures ou e-mail qui a déjà commandé), plafond.
create function lier_parrainage(p_email text, p_code text) returns text
language plpgsql as $$
declare
  f comptes%rowtype;
  parrain uuid;
  debut_mois timestamptz := date_trunc('month', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
begin
  if not fidelite_active() then
    return 'desactive';
  end if;
  select id into parrain from comptes where code_parrainage = upper(btrim(coalesce(p_code, '')));
  if parrain is null then
    return 'code';
  end if;
  select * into f from comptes where email = email_normal(p_email) for update;
  if not found then
    return 'code';
  end if;
  if f.id = parrain then
    return 'soi_meme';
  end if;
  if exists (select 1 from parrainages where filleul_id = f.id) then
    return 'deja';
  end if;
  if f.cree_le < now() - interval '24 hours'
     or exists (select 1 from commandes where email_normal(client_email) = f.email) then
    return 'ancien';
  end if;
  perform 1 from comptes where id = parrain for update;
  if (select count(*) from parrainages where parrain_id = parrain and cree_le >= debut_mois)
     >= greatest(fidelite_entier('parrainage_plafond_mois', 10), 0) then
    return 'plafond';
  end if;
  insert into parrainages (parrain_id, filleul_id) values (parrain, f.id);
  return 'ok';
end;
$$;

-- À la première commande livrée ou retirée du filleul : CHF 10 à chacun, ou refus si le téléphone ou l'adresse de
-- cette commande ont déjà été vus (chez le parrain ou dans une autre commande). Une seule fois par filleul.
create function crediter_parrainage(p_commande uuid) returns text
language plpgsql as $$
declare
  o commandes%rowtype;
  p parrainages%rowtype;
  tel text;
  adr text;
  montant integer := greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0);
  v_raison text;
begin
  select * into o from commandes where id = p_commande;
  if not found or o.statut <> 'terminee' or o.compte_id is null
     or o.motif is not distinct from 'Client absent à la livraison.' or not fidelite_active() then
    return null;
  end if;
  select * into p from parrainages where filleul_id = o.compte_id and statut = 'en_attente' for update;
  if not found then
    return null;
  end if;
  tel := telephone_normal(o.client_telephone);
  adr := case when o.mode = 'livraison' then adresse_cle(o.adresse) end;
  if tel <> '' and (
       exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id and telephone_normal(x.client_telephone) = tel
               and x.statut not in ('paiement_en_attente', 'annulee'))
       or exists (select 1 from comptes k where k.id = p.parrain_id and telephone_normal(k.telephone) = tel)) then
    v_raison := 'telephone';
  elsif adr is not null and exists (select 1 from commandes x where x.compte_id is distinct from o.compte_id and x.mode = 'livraison'
               and adresse_cle(x.adresse) = adr and x.statut not in ('paiement_en_attente', 'annulee')) then
    v_raison := 'adresse';
  end if;
  if v_raison is not null then
    update parrainages set statut = 'refuse', raison = v_raison, commande_id = o.id, termine_le = now() where id = p.id;
    return v_raison;
  end if;
  update parrainages set statut = 'credite', commande_id = o.id, termine_le = now() where id = p.id;
  if montant > 0 then
    insert into cagnotte_mouvements (compte_id, commande_id, type, montant_centimes, motif)
      values (p.parrain_id, o.id, 'parrainage', montant, 'Parrainage d''un proche'),
             (o.compte_id, o.id, 'parrainage', montant, 'Bienvenue par parrainage');
  end if;
  return 'credite';
end;
$$;

create or replace function cagnotte_au_statut() returns trigger
language plpgsql as $$
begin
  if new.statut = 'terminee' and old.statut is distinct from 'terminee' then
    perform crediter_cagnotte(new.id);
    perform crediter_parrainage(new.id);
  end if;
  -- La cagnotte utilisée revient seulement si la commande n'a pas eu lieu : refusée, annulée, paiement échoué.
  -- Un remboursement après coup (plats retirés, geste) ne rend que de l'argent, au plus ce qui a été payé : passer
  -- « remboursée » quand l'argent payé est rendu ne rend pas la cagnotte (revue de sécurité). Le gain, lui, est
  -- recalculé à chaque remboursement fait (cagnotte_au_remboursement).
  if (new.statut in ('refusee', 'annulee') and old.statut is distinct from new.statut)
     or (new.statut_paiement = 'echec' and old.statut_paiement is distinct from 'echec') then
    perform rendre_cagnotte(new.id);
    perform ajuster_gain(new.id);
  elsif new.statut_paiement = 'rembourse' and old.statut_paiement is distinct from 'rembourse' then
    perform ajuster_gain(new.id);
  end if;
  return null;
end;
$$;

-- Parrainage du compte : { actif, code, montant_centimes, credites, en_attente, parraine: 'en_attente' | 'credite' |
-- 'refuse' | null }. Jamais l'identité de l'autre personne.
create function parrainage_compte(p_compte uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
    'actif', fidelite_active(),
    'code', case when fidelite_active() then code_parrainage(p_compte) end,
    'montant_centimes', greatest(fidelite_entier('parrainage_montant_centimes', 1000), 0),
    'credites', (select count(*) from parrainages where parrain_id = p_compte and statut = 'credite'),
    'en_attente', (select count(*) from parrainages where parrain_id = p_compte and statut = 'en_attente'),
    'parraine', (select statut from parrainages where filleul_id = p_compte)
  );
$$;

revoke execute on function code_parrainage(uuid), lier_parrainage(text, text), crediter_parrainage(uuid), parrainage_compte(uuid)
  from public, anon, authenticated;
grant execute on function code_parrainage(uuid), lier_parrainage(text, text), crediter_parrainage(uuid), parrainage_compte(uuid)
  to service_role;
