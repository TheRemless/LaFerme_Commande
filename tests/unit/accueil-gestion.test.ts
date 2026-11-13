import { describe, expect, it } from "vitest";
import { alertesDe, livraisonAuService, resumerCommandes, type DonneesAccueil } from "@/lib/accueil-gestion";
import { aNotifier, lirePreferences, PREFERENCES_PAR_DEFAUT, titreAvecCompteur, TYPES_ALERTE } from "@/lib/alertes-types";
import type { ConfigService } from "@/lib/service";
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

  it("les remboursements à suivre (tous jours) remplacent le compte du seul service en cours", () => {
    const ventes = { periode: { remboursements: { echecs_ouverts: 9, en_cours: 9 } } } as unknown as DonneesAccueil["ventes"];
    const a = alertesDe({
      ...vide,
      ventes,
      remboursements: {
        echecs: [
          { numero: 12, cree_le: "2026-11-10T12:00:00Z" },
          { numero: 12, cree_le: "2026-11-10T12:05:00Z" },
        ],
        bloques: [{ numero: 30, cree_le: "2026-11-11T19:00:00Z" }],
      },
    });
    expect(a.find((x) => x.cle === "remboursements")).toMatchObject({ titre: "2 remboursements ont échoué", detail: "Le client n'a pas été remboursé. N° 12.", depuis: "2026-11-10T12:00:00Z" });
    expect(a.find((x) => x.cle === "remboursements-en-cours")?.titre).toBe("1 remboursement pas confirmé par Stripe depuis plus de 24 heures");
    // Sans la fonction (base pas encore migrée) : retour aux chiffres du service en cours.
    const avant = alertesDe({ ...vide, ventes, remboursements: null });
    expect(avant.find((x) => x.cle === "remboursements")?.titre).toBe("9 remboursements ont échoué ce soir");
  });

  it("le quota épuisé devient bloquant", () => {
    const a = alertesDe({ ...vide, quota: { envoyes: 500, refuses: 4, plafond: 500, restants: 0, libere_a: null, alerte: true } });
    expect(a[0]).toMatchObject({ cle: "courriels", niveau: "bloquant" });
  });

  it("chaque alerte a un type réglable", () => {
    const a = alertesDe({
      ...vide,
      tablette_muette: true,
      hier_a_encaisser: 2,
      livreurs_prevus: 0,
      quota: { envoyes: 420, refuses: 0, plafond: 500, restants: 80, libere_a: null, alerte: true },
      remboursements: { echecs: [{ numero: 1, cree_le: "2026-11-10T12:00:00Z" }], bloques: [] },
    });
    const types = new Set<string | undefined>(TYPES_ALERTE.map((t) => t.type));
    expect(a.length).toBeGreaterThan(3);
    for (const x of a) expect(types.has(x.type)).toBe(true);
  });

  it("les remboursements et le comptoir citent chaque commande avec son jour, et la liste filtrée", () => {
    const a = alertesDe({
      ...vide,
      hier_a_encaisser: 2,
      hier_a_encaisser_commandes: [
        { id: "c1", numero: 30, jour: "2026-11-10" },
        { id: "c2", numero: 30, jour: "2026-11-11" },
      ],
      remboursements: {
        echecs: [
          { numero: 36, cree_le: "2026-11-09T12:00:00Z", commande_id: "r1", jour: "2026-11-09" },
          { numero: 36, cree_le: "2026-11-09T12:05:00Z", commande_id: "r1", jour: "2026-11-09" },
          { numero: 4, cree_le: "2026-11-12T19:00:00Z", commande_id: "r2", jour: "2026-11-12" },
        ],
        bloques: [],
      },
    });
    const r = a.find((x) => x.cle === "remboursements")!;
    // Deux essais sur la même commande : une seule fiche. Le numéro n'est plus répété dans le texte.
    expect(r.commandes).toEqual([
      { id: "r1", numero: 36, jour: "2026-11-09" },
      { id: "r2", numero: 4, jour: "2026-11-12" },
    ]);
    expect(r.detail).toBe("Le client n'a pas été remboursé.");
    expect(r.liste?.href).toBe("/gestion/commandes?remboursement=echec&du=2026-11-09&au=2026-11-13");
    const c = a.find((x) => x.cle === "comptoir-hier")!;
    expect(c.commandes?.map((x) => x.jour)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(c.liste?.href).toBe("/gestion/commandes?paiement=a_encaisser_retrait&du=2026-11-06&au=2026-11-12");
    // Aucune donnée de client dans une adresse.
    for (const x of a) expect(x.liste?.href ?? "").not.toMatch(/@|Léa|Essai/);
  });

  it("aucun livreur prévu : alerte, bloquante pendant le service ; rien quand la livraison n'est pas ouverte", () => {
    expect(alertesDe({ ...vide, livreurs_prevus: 0 })[0]).toMatchObject({ cle: "livreurs", titre: "Aucun livreur prévu ce soir", niveau: "attention", geste: { href: "/gestion/livreurs" } });
    expect(alertesDe({ ...vide, livreurs_prevus: 2 })).toEqual([]);
    expect(alertesDe({ ...vide, livreurs_prevus: null })).toEqual([]);
  });

  it("la livraison compte comme ouverte seulement avant la fin du service et avec une zone livrée à ce service", () => {
    const config = {
      reglages: { creneau_minutes: 15, preparation_minutes: 20, retard_minutes: 0 },
      horaires: [{ jour: 5, service: "soir", premiere_heure: "18:30", derniere_heure: "22:30", derniere_commande: "22:00", derniere_commande_pizzas: "22:15" }],
      ouvertures: [],
      fermetures: [],
      zones: [{ numero: 1, nom: "Onex", frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 45, active: true, proposition: false, services: ["soir"] }],
      npa: [],
      pause: null,
    } as unknown as ConfigService;
    expect(livraisonAuService(config, maintenant, "2026-11-13", "soir")).toBe(true);
    expect(livraisonAuService(config, new Date("2026-11-13T22:00:00Z"), "2026-11-13", "soir")).toBe(false);
    expect(livraisonAuService({ ...config, zones: [{ ...config.zones[0], services: ["midi"] }] }, maintenant, "2026-11-13", "soir")).toBe(false);
  });
});

describe("préférences des alertes (par appareil)", () => {
  const alerte = (cle: string, type: (typeof TYPES_ALERTE)[number]["type"]) => ({ cle, type, niveau: "attention" as const, titre: cle });

  it("relit un stockage abîmé avec les valeurs par défaut, notifications coupées", () => {
    expect(lirePreferences(null)).toEqual(PREFERENCES_PAR_DEFAUT);
    expect(lirePreferences({ notifier: "oui", types: { comptoir: true, inconnu: true, retard: 3 } })).toEqual({
      notifier: false,
      types: { ...PREFERENCES_PAR_DEFAUT.types, comptoir: true },
    });
  });

  it("notifie seulement les alertes nouvelles d'un type choisi", () => {
    const prefs = { notifier: true, types: { ...PREFERENCES_PAR_DEFAUT.types, comptoir: false } };
    const a = [alerte("tablette", "tablette"), alerte("comptoir-hier", "comptoir"), alerte("retard", "retard")];
    expect(aNotifier(a, new Set(["retard"]), prefs).map((x) => x.cle)).toEqual(["tablette"]);
    expect(aNotifier(a, new Set(), { ...prefs, notifier: false })).toEqual([]);
    // Une alerte sans type (construite par une autre session) prévient toujours.
    expect(aNotifier([{ cle: "sans-livreur", niveau: "bloquant", titre: "x" }], new Set(), prefs).map((x) => x.cle)).toEqual(["sans-livreur"]);
  });

  it("met le compteur devant le titre de l'onglet sans l'empiler", () => {
    expect(titreAvecCompteur("Commandes | La Ferme", 3)).toBe("(3) Commandes | La Ferme");
    expect(titreAvecCompteur("(3) Commandes | La Ferme", 1)).toBe("(1) Commandes | La Ferme");
    expect(titreAvecCompteur("(3) Commandes | La Ferme", 0)).toBe("Commandes | La Ferme");
  });
});
