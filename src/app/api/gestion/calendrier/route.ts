import { NextResponse } from "next/server";
import { refus } from "@/lib/comptes/api";
import { calendrier, feriesAConfirmer } from "@/lib/calendrier";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import { exigerGerant } from "@/lib/personnel/session";
import { ajouterJours, instantGeneve } from "@/lib/service";

// Calendrier du back-office (gérant, vague 3). GET ?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ (62 jours au plus ; sans
// date : aujourd'hui et 41 jours). Pour chaque jour : ce que voit le client par service et ce qui le décide,
// le férié éventuel, les commandes déjà prises (nombres, sans donnée de client). Plus les fériés de l'année qui
// vient où le restaurant serait ouvert. Les fermetures et ouvertures se posent avec /api/gestion/service.
const SANS_CACHE = { "Cache-Control": "no-store, private" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valide = (v: string | null) => (v && DATE.test(v) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v) ? v : null);

type Reservation = { jour: string; service: "midi" | "soir"; livraisons: number; retraits: number };

export async function GET(requete: Request) {
  const g = await exigerGerant(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const q = new URL(requete.url).searchParams;
  const aujourdHui = instantGeneve(new Date()).date;
  const debut = q.get("debut") === null ? aujourdHui : valide(q.get("debut"));
  const fin = q.get("fin") === null && debut ? ajouterJours(debut, 41) : valide(q.get("fin"));
  if (!debut || !fin || fin < debut || fin > ajouterJours(debut, 61)) return refus("Période invalide : 62 jours au plus.", 400);
  const [config, reservations] = await Promise.all([
    chargerConfigService(),
    // Absente tant que la base n'est pas migrée : le calendrier s'affiche sans les commandes.
    fonctionSql<Reservation[]>("reservations_par_jour", { p_debut: debut, p_fin: fin }).catch(() => null),
  ]);
  const jours = calendrier(config, debut, fin).map((j) => ({
    ...j,
    services: j.services.map((s) => {
      const r = reservations?.find((x) => x.jour === j.date && x.service === s.service);
      return { ...s, commandes: r ? { livraisons: r.livraisons, retraits: r.retraits } : { livraisons: 0, retraits: 0 } };
    }),
  }));
  return NextResponse.json(
    { debut, fin, jours, commandes_disponibles: reservations !== null, feries_a_confirmer: feriesAConfirmer(config, aujourdHui, ajouterJours(aujourdHui, 365)) },
    { headers: SANS_CACHE },
  );
}
