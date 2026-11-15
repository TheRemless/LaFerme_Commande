-- Vague 3, client-commande : retour arrière depuis Stripe (revue de sécurité de client-compte, 15.11.2026).
-- Avant : l'ancienne session était expirée avant que la nouvelle soit liée. Le webhook « expired » de l'ancienne
-- pouvait annuler la commande entre les deux ; la nouvelle session, payée ensuite, ne la confirmait jamais et
-- l'argent restait chez Stripe sans que personne le sache.
--
-- 1. annuler_paiement_session : un échec ou une expiration n'annule la commande que si la session est encore
--    celle de la commande, vérifié sous le verrou de la ligne (la liaison d'une nouvelle session prend le même).
-- 2. Deux onglets : le client paie une session qui n'est plus la courante, au bon montant, alors que la commande
--    attend encore son paiement. Si la session a bien été créée pour cette commande (sessions_commande), ce
--    paiement la confirme sous le verrou de la ligne et devient le paiement de référence (confirmer_autre_session) ;
--    la session courante est ensuite expirée par le serveur.
-- 3. paiements_orphelins : un paiement réussi qui ne confirme pas sa commande (annulée, refusée, déjà payée par
--    une autre session, montant différent, session inconnue) est noté une fois, remboursé, et le gérant comme le
--    client sont prévenus une seule fois (src/lib/commandes.ts, rembourserPaiementOrphelin).
--
-- Objet partagé recréé : lier_session_paiement (20261107090000_commandes.sql), même signature et même effet, plus
-- la session notée dans sessions_commande. appliquer_paiement ne change pas.

create function annuler_paiement_session(p_evenement text, p_commande uuid, p_session text) returns boolean
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or c.stripe_session_id is distinct from p_session then
    return false;
  end if;
  return appliquer_paiement(p_evenement, p_commande, 'echec');
end;
$$;

-- Toutes les sessions créées pour une commande. Celles d'avant cette migration : seulement la courante.
create table sessions_commande (
  session_id text primary key check (char_length(session_id) between 3 and 255),
  commande_id uuid not null references commandes (id) on delete cascade,
  cree_le timestamptz not null default now()
);
create index sessions_commande_commande_idx on sessions_commande (commande_id);
alter table sessions_commande enable row level security;
revoke all on sessions_commande from anon, authenticated;
grant select, insert on sessions_commande to service_role;
insert into sessions_commande (session_id, commande_id)
  select stripe_session_id, id from commandes where stripe_session_id is not null
  on conflict (session_id) do nothing;

create or replace function lier_session_paiement(p_commande uuid, p_session text) returns void
language plpgsql as $$
begin
  update commandes set stripe_session_id = p_session where id = p_commande and statut_paiement = 'en_attente';
  if found then
    insert into sessions_commande (session_id, commande_id) values (p_session, p_commande) on conflict (session_id) do nothing;
  end if;
end;
$$;

-- Paiement d'une session qui n'est plus la courante (deux onglets). Confirme la commande seulement si elle attend
-- encore son paiement, au montant exact, et que la session a été créée pour elle. Rend { applique, ancienne_session }.
create function confirmer_autre_session(p_evenement text, p_commande uuid, p_session text, p_payment_intent text, p_montant integer) returns jsonb
language plpgsql as $$
declare
  c commandes%rowtype;
begin
  select * into c from commandes where id = p_commande for update;
  if not found or c.statut_paiement <> 'en_attente' or c.stripe_session_id is not distinct from p_session
     or p_montant is distinct from c.total_centimes
     or not exists (select 1 from sessions_commande s where s.session_id = p_session and s.commande_id = p_commande) then
    return jsonb_build_object('applique', false);
  end if;
  update commandes set stripe_session_id = p_session where id = p_commande;
  if not appliquer_paiement(p_evenement, p_commande, 'paye', p_payment_intent, p_montant) then
    update commandes set stripe_session_id = c.stripe_session_id where id = p_commande;
    return jsonb_build_object('applique', false);
  end if;
  return jsonb_build_object('applique', true, 'ancienne_session', c.stripe_session_id);
end;
$$;

create table paiements_orphelins (
  payment_intent text primary key check (char_length(payment_intent) between 3 and 255),
  commande_id uuid not null references commandes (id) on delete cascade,
  session_id text not null,
  montant_centimes integer,
  remboursement_id text,
  cree_le timestamptz not null default now(),
  rembourse_le timestamptz
);
alter table paiements_orphelins enable row level security;
revoke all on paiements_orphelins from anon, authenticated;
grant select, insert, update on paiements_orphelins to service_role;

-- Rend { nouveau, a_rembourser } : nouveau la première fois (alerte et e-mail), a_rembourser tant que le
-- remboursement n'est pas noté (un webhook rejoué retente le remboursement, jamais l'alerte).
create function noter_paiement_orphelin(p_payment_intent text, p_commande uuid, p_session text, p_montant integer) returns jsonb
language plpgsql as $$
declare
  o paiements_orphelins%rowtype;
begin
  insert into paiements_orphelins (payment_intent, commande_id, session_id, montant_centimes)
    values (p_payment_intent, p_commande, p_session, p_montant)
    on conflict (payment_intent) do nothing;
  if found then
    return jsonb_build_object('nouveau', true, 'a_rembourser', true);
  end if;
  select * into o from paiements_orphelins where payment_intent = p_payment_intent for update;
  return jsonb_build_object('nouveau', false, 'a_rembourser', o.rembourse_le is null);
end;
$$;

create function marquer_orphelin_rembourse(p_payment_intent text, p_remboursement text) returns void
language sql as $$
  update paiements_orphelins set remboursement_id = p_remboursement, rembourse_le = now()
  where payment_intent = p_payment_intent and rembourse_le is null;
$$;

revoke execute on function annuler_paiement_session(text, uuid, text), noter_paiement_orphelin(text, uuid, text, integer),
  marquer_orphelin_rembourse(text, text), confirmer_autre_session(text, uuid, text, text, integer),
  lier_session_paiement(uuid, text) from public, anon, authenticated;
grant execute on function annuler_paiement_session(text, uuid, text), noter_paiement_orphelin(text, uuid, text, integer),
  marquer_orphelin_rembourse(text, text), confirmer_autre_session(text, uuid, text, text, integer),
  lier_session_paiement(uuid, text) to service_role;
