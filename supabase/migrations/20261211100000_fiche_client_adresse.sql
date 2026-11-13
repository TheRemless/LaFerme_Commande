-- Vague 3, bo-commandes : la fiche d'un client plantait (« cannot delete from scalar ») pour un client dont
-- une commande à emporter a été passée par le site : l'adresse y est enregistrée en JSON null (et non en NULL
-- SQL), et « adresse - 'featureId' » refuse une valeur qui n'est pas un objet. Seules les adresses objets
-- comptent désormais.
--
-- Objet partagé recréé : fiche_client_gestion, reprise de sa seule définition (20261127120000_clients.sql),
-- avec seulement ce filtre changé. Nommée après la dernière migration de main (et après 20261211090000 de la
-- PR #98) pour cette raison. Compatible avant et après : même signature, même réponse.

create or replace function fiche_client_gestion(p_email text) returns jsonb
language plpgsql stable as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  r jsonb;
begin
  if not exists (select 1 from commandes where lower(client_email) = e and statut not in ('paiement_en_attente', 'annulee')) then
    return null;
  end if;
  with cmd as (
    select * from commandes o where lower(o.client_email) = e and o.statut not in ('paiement_en_attente', 'annulee')
  ),
  servies as (select * from cmd where statut <> 'refusee')
  select jsonb_build_object(
    'email', e,
    'prenom', (select client_prenom from cmd order by cree_le desc limit 1),
    'nom', (select client_nom from cmd order by cree_le desc limit 1),
    'commandes', (select count(*) from servies),
    'refusees', (select count(*) from cmd where statut = 'refusee'),
    'servi_centimes', (select coalesce(sum(total_centimes), 0) from servies),
    'rembourse_centimes', (select coalesce(sum(rb.montant_centimes), 0) from remboursements rb join servies s on s.id = rb.commande_id where rb.statut = 'fait'),
    'panier_moyen_centimes', (select round(avg(total_centimes))::integer from servies),
    'premiere_le', (select min(cree_le) from cmd), 'derniere_le', (select max(cree_le) from cmd),
    -- Jours en moyenne entre deux commandes servies (null avant la deuxième).
    'frequence_jours', (select case when count(*) > 1 then round(extract(epoch from max(cree_le) - min(cree_le)) / 86400 / (count(*) - 1), 1) end from servies),
    'livraisons', (select count(*) from servies where mode = 'livraison'),
    'retraits', (select count(*) from servies where mode = 'retrait'),
    'telephones', (select coalesce(jsonb_agg(t.tel order by t.derniere desc), '[]'::jsonb) from (
        select client_telephone as tel, max(cree_le) as derniere from cmd group by client_telephone) t),
    'adresses', (select coalesce(jsonb_agg(jsonb_build_object('adresse', a.adresse, 'fois', a.fois, 'derniere_le', a.derniere) order by a.derniere desc), '[]'::jsonb) from (
        select adresse - 'featureId' as adresse, count(*) as fois, max(cree_le) as derniere from cmd where jsonb_typeof(adresse) = 'object' group by adresse - 'featureId') a),
    'plats', (select coalesce(jsonb_agg(jsonb_build_object('nom', pl.nom, 'qte', pl.qte) order by pl.qte desc, pl.nom), '[]'::jsonb) from (
        select l.nom, sum(l.qte)::integer as qte from commande_lignes l join servies s on s.id = l.commande_id group by l.nom order by 2 desc, 1 limit 5) pl),
    'commandes_liste', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero', c.numero, 'jour_service', c.jour_service, 'cree_le', c.cree_le, 'mode', c.mode, 'statut', c.statut,
        'statut_paiement', c.statut_paiement, 'total_centimes', c.total_centimes,
        'rembourse_centimes', (select coalesce(sum(rb.montant_centimes), 0) from remboursements rb where rb.commande_id = c.id and rb.statut = 'fait')
      ) order by c.cree_le desc), '[]'::jsonb) from (select * from cmd order by cree_le desc limit 100) c),
    'remboursements', (select coalesce(jsonb_agg(jsonb_build_object(
        'commande_id', rb.commande_id, 'numero', c.numero, 'montant_centimes', rb.montant_centimes, 'motif', rb.motif, 'statut', rb.statut,
        'personnel_nom', rb.personnel_nom, 'cree_le', rb.cree_le) order by rb.cree_le desc), '[]'::jsonb)
      from remboursements rb join cmd c on c.id = rb.commande_id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', nc.id, 'texte', nc.texte, 'personnel_nom', nc.personnel_nom, 'cree_le', nc.cree_le) order by nc.cree_le desc), '[]'::jsonb)
      from notes_client nc where nc.email = e),
    'marque', (select jsonb_build_object('marque', m.marque, 'motif', m.motif, 'personnel_nom', m.personnel_nom, 'le', m.le) from marques_client m where m.email = e),
    'marque_active', coalesce((select (valeur #>> '{}')::boolean from reglages where cle = 'marque_client_active' and jsonb_typeof(valeur) = 'boolean'), false),
    'compte', (select jsonb_build_object('cree_le', k.cree_le, 'adresses', (select count(*) from adresses_compte ad where ad.compte_id = k.id)) from comptes k where k.email = e)
  ) into r;
  return r;
end;
$$;
