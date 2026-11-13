import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { oublierTemoinRegistre, retrouverAdresse, texteRecherche } from "@/lib/adresse-serveur";
import { chargerConfigService } from "@/lib/config-service";
import type { ConfigService } from "@/lib/service";
import { zoneServeur } from "@/lib/zone-serveur";

// Relecture de qualite (#222) : un client ne doit pas pouvoir provoquer le repli « panne du registre » (C15).
// geo.admin.ch répond 400 au-delà de 10 mots dans searchText : ce n'est pas une panne.

type Registre = "sain" | "en-panne" | "client-seul-en-erreur";
const envoyes: string[] = [];

function registre(etat: Registre) {
  return vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    const texte = u.searchParams.get("searchText") ?? "";
    envoyes.push(texte);
    const temoin = texte === "Route de Chancy 132 1213";
    if (etat === "en-panne" || (etat === "client-seul-en-erreur" && !temoin)) return new Response("Bad gateway", { status: 502 });
    if (texte.split(/\s+/).length > 10) return new Response("The searchText parameter can not contain more than 10 words", { status: 400 });
    const resultats = temoin ? [{ attrs: { label: "Route de Chancy 132 <b>1213 Onex</b>", featureId: "1" } }] : [];
    return new Response(JSON.stringify({ results: resultats }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

const LONGUE = { rue: "Rue de Carouge au fond de la cour à gauche", numero: "50", npa: "1213", localite: "Onex" };
let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});
afterEach(() => {
  vi.unstubAllGlobals();
  oublierTemoinRegistre();
  envoyes.length = 0;
});

describe("texte envoyé au registre", () => {
  it("jamais plus de 10 mots, la rue raccourcie d'abord par ses mots vides", () => {
    expect(texteRecherche({ rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213" })).toBe("Avenue du Gros-Chêne 20 1213");
    const t = texteRecherche(LONGUE);
    expect(t.split(" ").length).toBeLessThanOrEqual(10);
    expect(t.endsWith("50 1213")).toBe(true);
    expect(t.startsWith("Rue Carouge")).toBe(true);
    const tresLongue = texteRecherche({ rue: "Chemin un deux trois quatre cinq six sept huit neuf dix onze", numero: "3 bis", npa: "1213" });
    expect(tresLongue.split(" ").length).toBe(10);
  });
});

describe("registre sain, entrée inattendue", () => {
  it("rue trop longue au paiement : 422, jamais livrable non vérifiée", async () => {
    vi.stubGlobal("fetch", registre("sain"));
    const r = await zoneServeur(config, LONGUE, true);
    expect(r).toMatchObject({ code: 422 });
    expect(envoyes.every((t) => t.split(/\s+/).length <= 10)).toBe(true);
  });

  it("une réponse 400 du registre veut dire « introuvable »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("non", { status: 400 })));
    await expect(retrouverAdresse({ rue: "Rue de Carouge", numero: "50", npa: "1213", localite: "Onex" })).resolves.toBeNull();
  });

  it("erreur sur l'adresse du client, mais l'adresse témoin répond : 422, pas de repli", async () => {
    vi.stubGlobal("fetch", registre("client-seul-en-erreur"));
    expect(await zoneServeur(config, { rue: "Rue de Carouge", numero: "50", npa: "1213", localite: "Onex" }, true)).toMatchObject({ code: 422 });
    expect(await zoneServeur(config, { featureId: "1234567_0", rue: "Rue de Carouge", numero: "50", npa: "1213", localite: "Onex" })).toMatchObject({ code: 422 });
  });
});

describe("registre saturé (429)", () => {
  it("compte comme une panne, pas comme une adresse introuvable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Too many requests", { status: 429 })));
    await expect(retrouverAdresse({ rue: "Rue de Carouge", numero: "50", npa: "1213", localite: "Onex" })).rejects.toThrow();
    // L'adresse témoin reçoit aussi 429 : repli sur le NPA, adresse non vérifiée.
    const r = await zoneServeur(config, { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }, true);
    expect(r).toMatchObject({ statut: "livrable", verifiee: false, adresse: { nonVerifiee: true } });
    oublierTemoinRegistre();
    expect(await zoneServeur(config, { featureId: "1234567_0", rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" })).toMatchObject({ statut: "livrable", verifiee: false });
  });
});

describe("vraie panne", () => {
  it("le registre et l'adresse témoin muets : l'adresse est acceptée sur son NPA, non vérifiée", async () => {
    vi.stubGlobal("fetch", registre("en-panne"));
    const r = await zoneServeur(config, { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }, true);
    expect(r).toMatchObject({ statut: "livrable", verifiee: false, adresse: { nonVerifiee: true } });
  });

  it("l'état du témoin est gardé 60 secondes : une seule requête témoin pour deux clients", async () => {
    const f = registre("en-panne");
    vi.stubGlobal("fetch", f);
    await zoneServeur(config, { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }, true);
    await zoneServeur(config, { rue: "Avenue du Gros-Chêne", numero: "22", npa: "1213", localite: "Onex" }, true);
    expect(envoyes.filter((t) => t === "Route de Chancy 132 1213")).toHaveLength(1);
  });
});
