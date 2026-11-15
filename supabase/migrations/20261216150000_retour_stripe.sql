-- Vague 3, client-commande : retour arrière depuis Stripe (revue de sécurité de client-compte, 15.11.2026).
-- Avant : l'ancienne session était expirée avant que la nouvelle soit liée. Le webhook « expired » de l'ancienne
-- pouvait annuler la commande entre les deux ; la nouvelle session, payée ensuite, ne la confirmait jamais et
-- l'argent restait chez Stripe sans que personne le sache.
--
-- 1. annuler_paiement_session : un échec ou une expiration n'annule la commande que si la session est encore
--    celle de la commande, vérifié sous le verrou de la ligne (la liaison d'une nouvelle session prend le même).
-- 2. paiements_orphelins : un paiement réussi qui ne confirme pas sa commande (annulée, refusée, déjà payée par
--    une autre session, montant différent) est noté une fois, remboursé, et le gérant comme le client sont
--    prévenus une seule fois (src/lib/commandes.ts, rembourserPaiementOrphelin).
--
-- Objets neufs seulement. appliquer_paiement et lier_session_paiement ne changent pas.

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
  marquer_orphelin_rembourse(text, text) from public, anon, authenticated;
grant execute on function annuler_paiement_session(text, uuid, text), noter_paiement_orphelin(text, uuid, text, integer),
  marquer_orphelin_rembourse(text, text) to service_role;
