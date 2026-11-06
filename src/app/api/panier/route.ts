import { NextResponse } from "next/server";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { calculerPanier, LIMITES, type LignePanier } from "@/lib/panier";
import { depuisHeureGeneve, enMinutes, heureTexte, instantGeneve, jourIso, quandPossible, type Quand, type Zone } from "@/lib/service";
import { zoneServeur } from "@/lib/zone-serveur";

// Prix du panier calculé par le serveur à partir de la base : options, frais de zone, minimum, TVA,
// et contrôle que le moment demandé reste possible pour ce contenu. Rien n'est enregistré.

function lignesValides(v: unknown): LignePanier[] | null {
  if (!Array.isArray(v) || v.length > LIMITES.lignes) return null;
  const lignes: LignePanier[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const l = x as Record<string, unknown>;
    if (typeof l.slug !== "string" || l.slug.length > 80 || typeof l.qte !== "number") return null;
    const choix: Record<string, string[]> = {};
    if (l.choix && typeof l.choix === "object") {
      for (const [g, noms] of Object.entries(l.choix as Record<string, unknown>)) {
        if (g === "__proto__" || g === "constructor" || g === "prototype") return null;
        if (!Array.isArray(noms) || noms.length > 40 || noms.some((n) => typeof n !== "string" || n.length > 80)) return null;
        choix[g.slice(0, 80)] = noms as string[];
      }
    }
    const retraits = Array.isArray(l.retraits) ? l.retraits : [];
    if (retraits.length > 20 || retraits.some((r) => typeof r !== "string" || r.length > 80)) return null;
    const note = typeof l.note === "string" ? l.note : "";
    if (note.length > 500) return null;
    lignes.push({ slug: l.slug, qte: l.qte, choix, retraits: retraits as string[], note });
  }
  return lignes;
}

function quandValide(v: unknown): Quand {
  const q = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (q.type === "asap") return { type: "asap" };
  if (q.type === "creneau" && typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && Number.isInteger(q.minutes)) {
    return { type: "creneau", date: q.date, minutes: q.minutes as number };
  }
  return { type: "aucun" };
}

export async function POST(requete: Request) {
  let corps: Record<string, unknown>;
  try {
    corps = await requete.json();
  } catch {
    return NextResponse.json({ erreur: "Requête illisible." }, { status: 400 });
  }
  const lignes = lignesValides(corps.lignes);
  if (!lignes) return NextResponse.json({ erreur: "Panier illisible." }, { status: 422 });
  const mode = corps.mode === "livraison" ? "livraison" : corps.mode === "retrait" ? "retrait" : null;
  if (!mode) return NextResponse.json({ erreur: "Choisissez livraison ou à emporter." }, { status: 422 });

  const [catalogue, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);

  let zone: Zone | undefined;
  if (mode === "livraison") {
    const r = await zoneServeur(config, corps.adresse);
    if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: r.code });
    if (r.statut !== "livrable") return NextResponse.json({ erreur: "Cette adresse est hors de notre zone de livraison." }, { status: 422 });
    zone = r.zone;
  }

  const totaux = calculerPanier(catalogue, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);

  // Hors production, l'heure simulée de l'accueil (?heure=) suit jusqu'ici pour tester les états.
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const simulee = preversion && typeof corps.heure === "string" ? depuisHeureGeneve(corps.heure) : null;
  const maintenant = simulee ?? new Date();
  const quand = quandValide(corps.quand);
  let messageQuand: string | null = null;
  if (lignes.length > 0 && !quandPossible(config, maintenant, mode, zone, totaux.pizzas_seulement, quand)) {
    const pourPizzas = !totaux.pizzas_seulement && quandPossible(config, maintenant, mode, zone, true, quand);
    if (pourPizzas) {
      // Le service concerné est celui du moment demandé : aujourd'hui pour « dès que possible », sinon celui du créneau.
      const ici = instantGeneve(maintenant);
      const h =
        quand.type === "creneau"
          ? config.horaires.find(
              (x) => x.jour === jourIso(quand.date) && enMinutes(x.premiere_heure) <= quand.minutes && quand.minutes <= enMinutes(x.derniere_heure),
            )
          : config.horaires.find((x) => x.jour === ici.jour && ici.minutes <= enMinutes(x.derniere_commande_pizzas));
      messageQuand = h
        ? `Après ${heureTexte(enMinutes(h.derniere_commande))}, on ne prend plus que les pizzas. Retirez les autres plats ou choisissez une autre heure.`
        : "À cette heure-là, on ne prend plus que les pizzas. Retirez les autres plats ou choisissez une autre heure.";
    } else {
      messageQuand = "Ce moment n'est plus disponible. Choisissez une autre heure.";
    }
  }

  return NextResponse.json({ ...totaux, valide: totaux.valide && messageQuand === null, message_quand: messageQuand });
}
