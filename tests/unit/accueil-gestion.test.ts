import { describe, expect, it } from "vitest";
import { alertesDe, resumerCommandes, type DonneesAccueil } from "@/lib/accueil-gestion";
import type { CommandeTablette } from "@/lib/tablette";

// Accueil du back-office (vague 3) : ce que le gérant voit en premier. Les calculs de ventes sont ceux de
// pilotage_ventes (testés par bo-pilotage) ; ici, le tri des commandes et les alertes.
const maintenant = new Date("2026-11-13T19:30:00Z"); // 20h30 à Genève

function commande(x: Partial<CommandeTablette>): CommandeTablette {
  return {
    id: String(x.numero),
    numero: 1,
    cree_le: "2026-11-13T19:00:00Z",
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    client_prenom: "Léa",
    client_nom: "Essai",
    client_telephone: "079 000 00 00",
    adresse: null,
    details_livraison: null,
    zone_numero: null,
    quand_type: "asap",
    quand_date: null,
    quand_minutes: null,
    heure_confirmee: null,
    total_centimes: 2000,
    frais_centimes: 0,
    motif: null,
    avertissement: null,
    attend_depuis: "2026-11-13T19:28:00Z",
    lignes: [],
    heure_proposee: "2026-11-13T19:55:00Z",
    ...x,
  };
}

const vide: DonneesAccueil = {
  maintenant: maintenant.toISOString(),
  jour: "2026-11-13",
  service: "soir",
  commandes: null,
  restaurant: null,
  ventes: null,
  hier_a_encaisser: 0,
  impression: { imprimantes: [], echecs: 0 },
  tablette_muette: false,
  quota: null,
  alerte_acceptation_minutes: 5,
};

describe("résumé des commandes", () => {
  const file = [
    commande({ numero: 40, attend_depuis: "2026-11-13T19:20:00Z" }), // 10 min : en retard d'acceptation
    commande({ numero: 41 }), // 2 min
    commande({ numero: 42, quand_type: "creneau", quand_date: "2026-11-14", quand_minutes: 1170 }), // demain
    commande({ numero: 30, statut: "acceptee", heure_confirmee: "2026-11-13T19:20:00Z" }), // heure passée
    commande({ numero: 31, statut: "en_preparation", heure_confirmee: "2026-11-13T19:45:00Z" }),
    commande({ numero: 32, statut: "prete", heure_confirmee: "2026-11-13T19:00:00Z" }), // prête : pas « en retard »
  ];
  const r = resumerCommandes(file, maintenant, 5);

  it("compte ce qui attend, la plus ancienne d'abord, sans les commandes d'un autre jour", () => {
    expect(r.a_accepter).toBe(2);
    expect(r.plus_ancienne).toBe("2026-11-13T19:20:00Z");
    expect(r.a_accepter_en_retard).toEqual([{ numero: 40, depuis: "2026-11-13T19:20:00Z" }]);
    expect(r.a_l_avance).toBe(1);
  });

  it("compte en cours et en retard après l'heure promise, une commande prête n'est pas en retard", () => {
    expect(r.en_cours).toBe(3);
    expect(r.pretes).toBe(1);
    expect(r.en_retard).toEqual([{ numero: 30, heure: "2026-11-13T19:20:00Z" }]);
  });
});

describe("alertes", () => {
  it("rien à signaler : aucune alerte", () => {
    expect(alertesDe(vide)).toEqual([]);
  });

  it("met d'abord ce qui bloque le service, puis ce qui est à régler aujourd'hui", () => {
    const d: DonneesAccueil = {
      ...vide,
      commandes: { ...resumerCommandes([], maintenant, 5), a_accepter_en_retard: [{ numero: 40, depuis: "2026-11-13T19:20:00Z" }], en_retard: [{ numero: 30, heure: "2026-11-13T19:20:00Z" }] },
      restaurant: { livraison: { etat: "pause", jusqua: null }, retrait: { etat: "pause", jusqua: null }, en_service: true, retard_minutes: 0, zones_fermees: [], ruptures: [] },
      impression: { imprimantes: [{ id: 1, nom: "Pizza", station: "pizza", actif: true, liee: true, vue_le: "2026-11-13T19:10:00Z", en_ligne: false, statut_code: null }], echecs: 2 },
      tablette_muette: true,
      quota: { envoyes: 410, refuses: 0, plafond: 500, restants: 90, libere_a: null, alerte: true },
      hier_a_encaisser: 3,
    };
    const a = alertesDe(d);
    expect(a.map((x) => x.cle)).toEqual(["a-accepter", "tablette", "pause", "imprimante-1", "tickets", "retard", "courriels", "comptoir-hier"]);
    expect(a.slice(0, 5).every((x) => x.niveau === "bloquant")).toBe(true);
    expect(a[0].titre).toBe("Commande 40 pas encore acceptée");
    expect(a.find((x) => x.cle === "tickets")!.titre).toBe("2 tickets pas imprimés");
    expect(a.find((x) => x.cle === "courriels")!.titre).toBe("E-mails : 410 sur 500 envoyés aujourd'hui");
    expect(a.find((x) => x.cle === "comptoir-hier")!.titre).toBe("3 commandes au comptoir des derniers jours pas notées encaissées");
  });

  it("une tablette muette hors service et une imprimante éteinte la nuit ne bloquent rien", () => {
    const d: DonneesAccueil = {
      ...vide,
      restaurant: { livraison: { etat: "ferme", prochain: { date: "2026-11-14", minutes: 690 } as never }, retrait: { etat: "ferme", prochain: { date: "2026-11-14", minutes: 690 } as never }, en_service: false, retard_minutes: 0, zones_fermees: [], ruptures: [] },
      impression: { imprimantes: [{ id: 2, nom: "Cuisine", station: "cuisine", actif: true, liee: true, vue_le: null, en_ligne: false, statut_code: null }], echecs: 0 },
      tablette_muette: true,
    };
    const a = alertesDe(d);
    expect(a.map((x) => x.cle)).toEqual(["imprimante-2"]);
    expect(a[0].niveau).toBe("attention");
  });

  it("le quota épuisé devient bloquant", () => {
    const a = alertesDe({ ...vide, quota: { envoyes: 500, refuses: 4, plafond: 500, restants: 0, libere_a: null, alerte: true } });
    expect(a[0]).toMatchObject({ cle: "courriels", niveau: "bloquant" });
  });
});
