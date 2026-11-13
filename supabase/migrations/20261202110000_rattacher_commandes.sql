-- Vague 3, client-compte : un client qui a commandé en invité retrouve ses commandes en se connectant.
-- Le code reçu par e-mail prouve l'adresse ; les commandes enregistrées avec elle et sans compte sont rangées
-- dans le sien (avant : seulement la commande du lien de suivi). Une commande détachée par la suppression
-- d'un compte reste à la comptabilité et n'est jamais rangée de nouveau.
-- Ajouts : colonnes commandes.detachee_du_compte et commandes.rangee_par_email (en fin de table),
-- déclencheur, fonction neuve. Objets recréés depuis leur seule définition (20261108090000_comptes.sql) :
-- export_compte(uuid, text), qui ne sort d'une commande rangée par e-mail que ce que l'e-mail de
-- confirmation montrait (liste blanche) ; verifier_code(…), dont le chemin par lien de suivi suit la même
-- règle (jamais une commande détachée, seul le prénom repris). Revue de sécurité du 13.11.2026. Aucun UPDATE ni DELETE sur des données existantes : les commandes déjà
-- détachées avant cette migration (comptes de test supprimés) ne sont pas distinguables, rien en production.

alter table commandes add column detachee_du_compte boolean not null default false;
-- Rangée dans un compte par la seule preuve de l'e-mail (pas par le lien de suivi ni la case « créer mon compte »).
alter table commandes add column rangee_par_email boolean not null default false;

-- Le compte d'une commande passe à vide (suppression du compte) : la commande est marquée détachée.
create function marquer_commande_detachee() returns trigger
language plpgsql as $$
begin
  if old.compte_id is not null and new.compte_id is null then
    new.detachee_du_compte := true;
  end if;
  return new;
end;
$$;
create trigger commandes_detachee before update of compte_id on commandes
  for each row execute function marquer_commande_detachee();
revoke execute on function marquer_commande_detachee() from public, anon, authenticated;

-- Appelée par le serveur juste après une connexion réussie (code vérifié). Rend le nombre de commandes rangées.
-- Index utilisé : commandes_email_idx (lower(client_email), cree_le desc).
create function rattacher_commandes_email(p_compte uuid) returns integer
language plpgsql as $$
declare
  e text;
  n integer;
begin
  select email into e from comptes where id = p_compte;
  if e is null then
    return 0;
  end if;
  with r as (
    update commandes set compte_id = p_compte, rangee_par_email = true
    where lower(client_email) = e and compte_id is null and not detachee_du_compte
      and statut not in ('paiement_en_attente', 'annulee')
      -- Une adresse e-mail se reprend (boîte recyclée, domaine racheté) : seulement les 12 derniers mois.
      and cree_le > now() - interval '12 months'
    returning id, cree_le
  )
  select count(*)::integer into n from r;
  -- Ni le profil ni les adresses ne sont recopiés, et l'export retire téléphone et détails de livraison de
  -- ces commandes : une commande passée avec une adresse e-mail mal tapée donnerait sinon le téléphone et le
  -- code d'entrée d'un inconnu au titulaire de cette adresse. Il ne voit que ce que l'e-mail de confirmation
  -- lui a déjà montré.
  return n;
end;
$$;
revoke execute on function rattacher_commandes_email(uuid) from public, anon, authenticated;
grant execute on function rattacher_commandes_email(uuid) to service_role;

-- Commande rangée par e-mail, dans l'export : seulement ce que l'e-mail de confirmation montrait (prénom,
-- adresse sans identifiant de bâtiment, quand, plats, montants, paiement, lien de suivi). Ni nom de famille,
-- ni téléphone, ni code d'entrée, ni notes internes, ni allergie.
create function commande_rangee_export(o commandes) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'numero', o.numero, 'cree_le', o.cree_le, 'mode', o.mode, 'statut', o.statut,
    'quand_type', o.quand_type, 'quand_date', o.quand_date, 'quand_minutes', o.quand_minutes, 'heure_confirmee', o.heure_confirmee,
    'client_prenom', o.client_prenom,
    'adresse', case when o.adresse is null then null else jsonb_build_object(
      'rue', o.adresse ->> 'rue', 'numero', o.adresse ->> 'numero', 'npa', o.adresse ->> 'npa', 'localite', o.adresse ->> 'localite') end,
    'sous_total_centimes', o.sous_total_centimes, 'frais_centimes', o.frais_centimes, 'total_centimes', o.total_centimes,
    'tva_centimes', o.tva_centimes, 'taux_tva_pourcent', o.taux_tva_pourcent,
    'moyen_paiement', o.moyen_paiement, 'statut_paiement', o.statut_paiement, 'jeton_suivi', o.jeton_suivi
  );
$$;
revoke execute on function commande_rangee_export(commandes) from public, anon, authenticated;
grant execute on function commande_rangee_export(commandes) to service_role;

-- Export des données du compte : même définition que 20261108090000_comptes.sql, sauf les commandes rangées
-- par e-mail, réduites à ce que l'e-mail de confirmation montrait (commande_rangee_export).
create or replace function export_compte(p_compte uuid, p_ip_court text) returns jsonb
language plpgsql as $$
declare
  r jsonb;
begin
  select jsonb_build_object(
    'export_le', now(),
    'compte', jsonb_build_object('email', c.email, 'prenom', c.prenom, 'nom', c.nom, 'telephone', c.telephone, 'cree_le', c.cree_le, 'modifie_le', c.modifie_le),
    'adresses', coalesce((
      select jsonb_agg(jsonb_build_object('adresse', a.adresse, 'details', a.details, 'utilisee_le', a.utilisee_le) order by a.utilisee_le desc)
      from adresses_compte a where a.compte_id = c.id
    ), '[]'::jsonb),
    'commandes', coalesce((
      select jsonb_agg(
        (case when o.rangee_par_email then commande_rangee_export(o)
          else to_jsonb(o) - 'cle_idempotence' - 'origine' - 'compte_id' - 'stripe_session_id' end) || jsonb_build_object(
          'lignes', coalesce((
            select jsonb_agg(to_jsonb(l) - 'id' - 'commande_id' order by l.position)
            from commande_lignes l where l.commande_id = o.id
          ), '[]'::jsonb)
        ) order by o.cree_le desc)
      from commandes o where o.compte_id = c.id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('ouverte_le', s.cree_le, 'expire_le', s.expire_le, 'fermee_le', s.revoquee_le) order by s.cree_le desc)
      from sessions_compte s where s.compte_id = c.id
    ), '[]'::jsonb),
    'journal', coalesce((
      select jsonb_agg(jsonb_build_object('evenement', j.evenement, 'le', j.le) order by j.le desc)
      from journal_connexions j where j.compte_id = c.id
    ), '[]'::jsonb)
  ) into r
  from comptes c where c.id = p_compte;
  if r is not null then
    insert into journal_connexions (compte_id, evenement, ip_court) values (p_compte, 'export', p_ip_court);
  end if;
  return r;
end;
$$;

-- Connexion par code : même définition que 20261108090000_comptes.sql, sauf le chemin par lien de suivi.
create or replace function verifier_code(
  p_email text, p_cle_email text, p_cle_ip text, p_code_hache text, p_ip_court text,
  p_session_hache text, p_ancienne_session_hache text default null, p_jeton_commande text default null
) returns jsonb
language plpgsql as $$
declare
  a integer;
  k codes_connexion%rowtype;
  trouve boolean;
  cid uuid;
  v_commande uuid;
begin
  perform pg_advisory_xact_lock(hashtext('code:' || p_cle_email));
  -- Par IP : cinq essais faux libres, puis 2 s, 4 s, 8 s… et trente par heure au plus.
  a := attente_limite('echec_ip', p_cle_ip, 30, interval '1 hour', 2, 5);
  if a > 0 then
    return jsonb_build_object('statut', 'attente', 'attente', a);
  end if;

  select * into k from codes_connexion
    where cle_email = p_cle_email and utilise_le is null and invalide_le is null and expire_le > now()
    order by cree_le desc limit 1
    for update;
  trouve := found;
  if trouve and k.prochain_essai_le > now() then
    return jsonb_build_object('statut', 'attente', 'attente', greatest(1, ceil(extract(epoch from (k.prochain_essai_le - now())))::integer));
  end if;

  if not trouve or not egal_constant(k.code_hache, p_code_hache) then
    insert into tentatives_connexion (action, cle) values ('echec_ip', p_cle_ip);
    if trouve then
      -- Dans SET, essais vaut encore l'ancienne valeur : 1 s, 2 s, 4 s, 8 s, puis le code est annulé.
      update codes_connexion set
        essais = essais + 1,
        prochain_essai_le = now() + make_interval(secs => power(2, essais)),
        invalide_le = case when essais + 1 >= 5 then now() else null end
      where id = k.id;
    end if;
    insert into journal_connexions (compte_id, evenement, ip_court)
      values ((select id from comptes where email = p_email), 'echec_code', p_ip_court);
    return jsonb_build_object('statut', 'invalide');
  end if;

  update codes_connexion set utilise_le = now() where id = k.id;
  insert into comptes (email) values (p_email) on conflict (email) do nothing;
  select id into cid from comptes where email = p_email;
  if p_ancienne_session_hache is not null then
    update sessions_compte set revoquee_le = now() where jeton_hache = p_ancienne_session_hache and revoquee_le is null;
  end if;
  insert into sessions_compte (compte_id, jeton_hache, expire_le) values (cid, p_session_hache, now() + interval '30 days');

  if p_jeton_commande is not null then
    -- Lien de suivi et code arrivent par le même e-mail : même règle que le rangement par e-mail
    -- (20261202110000). Jamais une commande détachée d'un compte supprimé ; seul le prénom est repris.
    update commandes set compte_id = cid, rangee_par_email = true
      where jeton_suivi = p_jeton_commande and client_email = p_email and compte_id is null and not detachee_du_compte
      returning id into v_commande;
    if v_commande is not null then
      update comptes set prenom = (select client_prenom from commandes where id = v_commande)
        where id = cid and prenom = '';
    end if;
  end if;
  insert into journal_connexions (compte_id, evenement, ip_court) values (cid, 'connexion', p_ip_court);
  return jsonb_build_object('statut', 'ok', 'compte_id', cid);
end;
$$;
