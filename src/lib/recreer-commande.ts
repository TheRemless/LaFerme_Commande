import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { confirmerCommandeComptoir } from "@/lib/commandes";
import { chargerConfigService } from "@/lib/config-service";
import { commandeParId, creerCommande, fonctionSql } from "@/lib/db/serveur";
import { nomClient } from "@/lib/nom-plat";
import type { LignePanier } from "@/lib/panier";
import { calculerPanier, platDe, prixChoix } from "@/lib/panier";
import type { Personnel } from "@/lib/personnel/session";
import { comptoirPermis } from "@/lib/plafond-comptoir";
import { erreurPlatsDuJour, momentDe } from "@/lib/plat-du-jour";
import { MESSAGE_CRENEAU_COMPLET, quandPossible, type Quand } from "@/lib/service";
import { signalerTablette } from "@/lib/tablette";
import { randomBytes } from "node:crypto";

// Recréer une commande à partir d'une autre (vague 3, bo-commandes) : le client appelle, le gérant reprend
// une commande passée. La nouvelle est à emporter, payée au comptoir, aux prix du jour, avec les mêmes
// plats, options, retraits et notes. Mêmes contrôles qu'une commande du site (plats en vente, options,
// plafond du comptoir, heure possible, plat du jour, capacité du créneau en base). Elle arrive sur la
// tablette « à accepter » comme les autres. Désactivé par défaut : réglage commande_telephone_active.

export type ResultatRecreation = { ok: true; id: string; numero: number; message: string } | { ok: false; message: string };

export async function recreerCommande(sourceId: string, quand: Quand, cle: string, p: Personnel): Promise<ResultatRecreation> {
  if (!(await fonctionSql<boolean>("commande_telephone_active", {}))) return { ok: false, message: "Recréer une commande au téléphone n'est pas encore activé." };
  if (quand.type === "aucun") return { ok: false, message: "Choisissez « dès que possible » ou un créneau." };
  const source = await commandeParId(sourceId);
  if (!source) return { ok: false, message: "Commande introuvable." };
  if (source.lignes.length === 0) return { ok: false, message: "Cette commande n'a aucun plat à reprendre." };

  const [catalogue, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);
  const lignes: LignePanier[] = source.lignes.map((l) => ({ slug: l.plat_slug, qte: l.qte, choix: l.choix ?? {}, retraits: l.retraits ?? [], note: l.note ?? "" }));
  const totaux = calculerPanier(catalogue, lignes, null);
  const fausse = totaux.lignes.find((l) => l.erreur);
  if (fausse) return { ok: false, message: `${nomClient(fausse.nom, platDe(catalogue, fausse.slug)?.categorie_slug === "pizzas")} : ${fausse.erreur}` };
  if (!comptoirPermis(totaux.total_centimes, config.plafondComptoirCentimes)) {
    return { ok: false, message: "Au-delà du plafond du paiement au comptoir : le client doit commander en ligne." };
  }
  const maintenant = new Date();
  if (!quandPossible(config, maintenant, "retrait", undefined, totaux.pizzas_seulement, quand)) return { ok: false, message: "Ce moment n'est pas possible. Choisissez une autre heure." };
  const jourRefuse = erreurPlatsDuJour(catalogue, lignes, momentDe(config, maintenant, "retrait", undefined, totaux.pizzas_seulement, quand));
  if (jourRefuse) return { ok: false, message: jourRefuse };

  let creee;
  try {
    creee = await creerCommande({
      jeton_suivi: randomBytes(24).toString("base64url"),
      cle_idempotence: cle,
      mode: "retrait",
      statut: "nouvelle",
      statut_paiement: "a_encaisser_retrait",
      moyen_paiement: "comptoir",
      client_prenom: source.client_prenom,
      client_nom: source.client_nom,
      client_telephone: source.client_telephone,
      client_email: source.client_email,
      adresse: null,
      details_livraison: null,
      zone_numero: null,
      quand_type: quand.type,
      quand_date: quand.type === "creneau" ? quand.date : null,
      quand_minutes: quand.type === "creneau" ? quand.minutes : null,
      pizzas_seulement: totaux.pizzas_seulement,
      sous_total_centimes: totaux.sous_total_centimes,
      frais_centimes: totaux.frais_centimes,
      total_centimes: totaux.total_centimes,
      tva_centimes: totaux.tva_centimes,
      taux_tva_pourcent: catalogue.tauxTvaPourcent,
      origine: source.origine,
      compte_id: source.compte_id ?? null,
      compte_demande: false,
      lignes: totaux.lignes.map((l) => ({
        slug: l.slug,
        nom: l.nom,
        station: catalogue.plats[l.slug].station,
        qte: l.qte,
        unitaire_centimes: l.unitaire_centimes,
        total_centimes: l.total_centimes,
        choix: l.choix,
        prix_choix: prixChoix(catalogue, l),
        retraits: l.retraits,
        note: l.note.trim(),
      })),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("creneau_complet")) return { ok: false, message: MESSAGE_CRENEAU_COMPLET };
    if (e instanceof Error && e.message.includes("plafond_comptoir")) return { ok: false, message: "Au-delà du plafond du paiement au comptoir : le client doit commander en ligne." };
    throw e;
  }
  // Rejouée avec la même clé (double appui) : la commande existe déjà, rien n'est refait.
  if (!creee.deja) {
    await fonctionSql("noter_recreation", { p_source: source.id, p_nouvelle: creee.id, p_personnel: p.id });
    await confirmerCommandeComptoir(creee.id);
    await signalerTablette();
  }
  return { ok: true, id: creee.id, numero: creee.numero, message: `Commande n° ${creee.numero} créée, à accepter sur la tablette. Le client reçoit la confirmation par e-mail.` };
}
