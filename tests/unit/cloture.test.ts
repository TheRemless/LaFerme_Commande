import { NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { csvCloture, montantCompte, regrouperEcarts, type ClotureJour } from "@/lib/cloture";
import { celluleCsv } from "@/lib/gestion";
import { jourDeService } from "@/lib/pilotage";

// Clôture du jour côté serveur : saisie des montants, CSV, route (gérant seulement, erreurs lisibles).
const acces = { gerant: true, id: "" };
vi.mock("@/lib/personnel/session", () => ({
  exigerGerant: async () =>
    acces.gerant
      ? { personnel: { id: acces.id, role: "gerant", nom: "Test" } }
      : { reponse: NextResponse.json({ erreur: "Réservé au gérant." }, { status: 403 }) },
}));

const { GET, POST } = await import("@/app/api/gestion/cloture/route");
const lire = (q: string) => GET(new Request(`http://localhost:3000/api/gestion/cloture?${q}`));
const cloturer = (corps: unknown) =>
  POST(new Request("http://localhost:3000/api/gestion/cloture", { method: "POST", body: JSON.stringify(corps), headers: { "Content-Type": "application/json" } }));

beforeAll(async () => {
  const db = await baseLocale();
  acces.id = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});
beforeEach(() => {
  acces.gerant = true;
});

describe("montants comptés", () => {
  it("lit les francs saisis, vide = pas compté, refuse le reste", () => {
    expect(montantCompte("1250.50")).toBe(125050);
    expect(montantCompte("1'250,5")).toBe(125050);
    expect(montantCompte(" 0 ")).toBe(0);
    expect(montantCompte(12.3)).toBe(1230);
    expect(montantCompte("")).toBeNull();
    expect(montantCompte(null)).toBeNull();
    for (const v of ["-5", "12.345", "abc", 1.005, -1, Number.NaN, {}]) expect(montantCompte(v), String(v)).toBeUndefined();
  });
});

describe("CSV du rapport Z", () => {
  it("une cellule ne garde son signe que si c'est un nombre", () => {
    expect(celluleCsv("-5.00")).toBe("-5.00");
    expect(celluleCsv("-12")).toBe("-12");
    expect(celluleCsv("-1+1.")).toBe("'-1+1.");
    expect(celluleCsv("+41 79")).toBe("'+41 79");
    expect(celluleCsv("a\rb")).toBe('"a\rb"');
  });

  it("neutralise une formule dans un motif et ne contient aucune donnée de client", async () => {
    const c = await (await lire(`jour=${jourDeService()}`)).json() as ClotureJour;
    c.rapport.remboursements.push({
      numero: 12, montant_centimes: 300, moyen: "especes", statut: "fait", motif: "=HYPERLINK(\"x\")", par: "Giuseppe",
      commande_refusee: false, erreur: null, heure: "19:40",
    });
    const csv = csvCloture(c);
    expect(csv.startsWith("﻿Clôture du jour;")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    c.rapport.remboursements[c.rapport.remboursements.length - 1].motif = "-2+3+cmd|' /C calc'!A0+1.";
    expect(csvCloture(c)).toContain(";'-2+3+cmd|' /C calc'!A0+1.;");
    expect(csv).toContain("Attendu au comptoir;;");
    expect(csv).toContain(";12;19:40;espèces;fait;3.00;");
    c.cloture = { jour: c.rapport.jour, especes_comptees_centimes: 0, carte_comptoir_centimes: null, attendu_comptoir_centimes: 0,
      ecart_centimes: 0, note: "", personnel_nom: "Giuseppe", cloture_le: "2026-12-04T22:40:00Z" };
    c.change_depuis = true;
    const clos = csvCloture(c);
    expect(clos).toContain("Clôturé le;2026-12-04 à 23h40 par Giuseppe");
    expect(clos).toContain("Attention;des commandes ont changé depuis la clôture");
  });
});

describe("route /api/gestion/cloture", () => {
  it("réservée au gérant", async () => {
    acces.gerant = false;
    expect((await lire("")).status).toBe(403);
    expect((await cloturer({ jour: jourDeService() })).status).toBe(403);
  });

  it("rend le rapport du jour en cours, en JSON ou en fichier", async () => {
    const j = (await (await lire("")).json()) as ClotureJour;
    expect(j.rapport.jour).toBe(jourDeService());
    const csv = await lire(`jour=${jourDeService()}&format=csv`);
    expect(csv.headers.get("content-disposition")).toContain(`la-ferme-cloture-${jourDeService()}.csv`);
    expect((await lire("jour=hier")).status).toBe(422);
  });

  it("clôture, puis refuse un jour à venir et un montant illisible avec un message clair", async () => {
    const r = await cloturer({ jour: jourDeService(), especes: "0", carte: "", note: "Test" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ jour: jourDeService(), note: "Test", carte_comptoir_centimes: null });

    const demain = await cloturer({ jour: "2099-01-01" });
    expect(demain.status).toBe(422);
    expect((await demain.json()).erreur).toMatch(/jour passé/);
    expect((await cloturer({ jour: jourDeService(), especes: "douze" })).status).toBe(422);
    expect((await cloturer({ jour: jourDeService(), note: 5 })).status).toBe(422);
  });
});

describe("à vérifier : les commandes pas terminées en une ligne", () => {
  it("garde l'argent à suivre en détail et compte les commandes pas terminées par statut", () => {
    const r = regrouperEcarts([
      { type: "pas_terminee", numero: 2, statut: "prete", centimes: 16190 },
      { type: "remboursement_echec", numero: 7, centimes: 2500 },
      { type: "pas_terminee", numero: 3, statut: "en_preparation", centimes: 3000 },
      { type: "pas_terminee", numero: 4, statut: "prete", centimes: 1000 },
    ]);
    expect(r.aSuivre).toEqual([{ type: "remboursement_echec", numero: 7, centimes: 2500 }]);
    expect(r.pasTerminees).toMatchObject({ commandes: 3, centimes: 20190, parStatut: [["prete", 2], ["en_preparation", 1]] });
    expect(r.pasTerminees.liste.map((x) => x.numero)).toEqual([2, 3, 4]);
    expect(regrouperEcarts([]).pasTerminees.commandes).toBe(0);
  });
});
