import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { champsNouveauPlat, champsPlat, champsPlatDuJour, listeSlugs, nouvelleOption, slugDe } from "@/lib/gestion";
import { formatDe, preparerPhoto } from "@/lib/photo-envoi";
import { estPhotoEnvoyee, urlPhoto } from "@/lib/photos";
import { erreurPlatsDuJour, momentDuChoix, motifPlatDuJour, serviceDe, serviceHoraire } from "@/lib/plat-du-jour";
import type { Catalogue } from "@/lib/panier";

// Carte gérée sans développeur : contrôles du serveur (src/lib/gestion.ts), plat du jour
// (src/lib/plat-du-jour.ts) et préparation des photos envoyées (src/lib/photo-envoi.ts).

const UUID = "0f8d2c1e-7a54-4b1e-9c3d-2e6f8a9b0c1d.jpg";

describe("nouveau plat", () => {
  const base = { categorie: "pates", nom: "  Risotto  aux cèpes ", prix: "24.50", station: "cuisine" };

  it("rend un slug sans accent et les champs propres", () => {
    const r = champsNouveauPlat({ ...base, retraits: ["cèpes", "cèpes"], groupes: ["choix-pates"], photo: "margherita.jpg", inconnu: 1 });
    expect(r).toEqual({
      ok: true,
      valeur: {
        nom: "Risotto aux cèpes",
        prix_centimes: 2450,
        prix_valide: false,
        commandable: false,
        station: "cuisine",
        categorie: "pates",
        slug: "risotto-aux-cepes",
        retraits: ["cèpes"],
        groupes: ["choix-pates"],
      },
    });
  });

  it("exige catégorie, nom, prix et poste, refuse un prix ou un groupe douteux", () => {
    expect(champsNouveauPlat({ ...base, categorie: undefined })).toMatchObject({ ok: false, erreur: "Choisissez une catégorie." });
    expect(champsNouveauPlat({ ...base, nom: "" })).toMatchObject({ ok: false, erreur: "Indiquez le nom du plat." });
    expect(champsNouveauPlat({ ...base, prix: "" })).toMatchObject({ ok: false, erreur: "Indiquez le prix." });
    expect(champsNouveauPlat({ ...base, station: "" })).toMatchObject({ ok: false });
    expect(champsNouveauPlat({ ...base, prix: "18.555" })).toMatchObject({ ok: false });
    expect(champsNouveauPlat({ ...base, prix: "-1" })).toMatchObject({ ok: false });
    expect(champsNouveauPlat({ ...base, groupes: ["../x"] })).toMatchObject({ ok: false });
    expect(champsNouveauPlat({ ...base, station: "bar" })).toMatchObject({ ok: false });
  });

  it("slugs : accents, ligatures, signes, vide", () => {
    expect(slugDe("Bœuf « Rossini » à l'ancienne")).toBe("boeuf-rossini-a-l-ancienne");
    expect(slugDe("!!!")).toBe("plat");
    expect(slugDe("a".repeat(100)).length).toBe(60);
  });

  it("listes d'ordre : seulement des slugs", () => {
    expect(listeSlugs(["pizzas", "pates"])).toEqual(["pizzas", "pates"]);
    expect(listeSlugs(["pizzas", "DROP TABLE"])).toBeNull();
    expect(listeSlugs("pizzas")).toBeNull();
  });

  it("nouveau supplément : nom et prix exigés", () => {
    expect(nouvelleOption({ nom: " Speck ", prix: "3" })).toEqual({ ok: true, valeur: { nom: "Speck", prix_centimes: 300, prix_valide: false } });
    expect(nouvelleOption({ nom: "", prix: "3" })).toMatchObject({ ok: false });
    expect(nouvelleOption({ nom: "Speck", prix: "abc" })).toMatchObject({ ok: false });
  });

  it("une fiche accepte une photo envoyée, refuse un chemin", () => {
    expect(champsPlat({ photo: UUID })).toEqual({ ok: true, valeur: { photo: UUID } });
    expect(champsPlat({ photo: "../../etc/passwd" })).toMatchObject({ ok: false, erreur: "Photo inconnue." });
    expect(champsPlat({ photo: `${UUID}.png` })).toMatchObject({ ok: false });
    expect(urlPhoto(UUID)).toBe(`/photos/${UUID}`);
    expect(urlPhoto("margherita.jpg")).toBe("/plats/margherita.jpg");
    expect(estPhotoEnvoyee("x.jpg")).toBe(false);
  });
});

describe("plat du jour", () => {
  const base = { nom: "Osso buco", prix: "26", station: "cuisine", jour: "2026-11-17", service: "midi" };

  it("rend un slug daté et ne garde que les champs utiles (prix valable dès la saisie)", () => {
    const r = champsPlatDuJour({ ...base, prix_valide: true, allergenes: "céleri", categorie: "pizzas", groupes: ["x"] }, "2026-11-17");
    expect(r).toEqual({
      ok: true,
      valeur: { nom: "Osso buco", prix_centimes: 2600, commandable: false, station: "cuisine", allergenes: "céleri", jour: "2026-11-17", service: "midi", slug: "jour-2026-11-17-osso-buco" },
    });
  });

  it("refuse une date passée ou illisible, un service inconnu", () => {
    expect(champsPlatDuJour({ ...base, jour: "2026-11-16" }, "2026-11-17")).toMatchObject({ ok: false });
    expect(champsPlatDuJour({ ...base, jour: "17.11.2026" }, "2026-11-17")).toMatchObject({ ok: false });
    expect(champsPlatDuJour({ ...base, service: "nuit" }, "2026-11-17")).toMatchObject({ ok: false });
  });

  it("midi avant 15h, soir après ; date et service contrôlés", () => {
    expect(serviceDe(12 * 60)).toBe("midi");
    expect(serviceDe(19 * 60)).toBe("soir");
    const midi = { date: "2026-11-17", service: "midi" as const };
    expect(motifPlatDuJour(midi, { date: "2026-11-17", minutes: 12 * 60 + 30 })).toBeNull();
    expect(motifPlatDuJour(midi, { date: "2026-11-17", minutes: 19 * 60 })).toBe("Seulement à midi.");
    expect(motifPlatDuJour(midi, { date: "2026-11-18", minutes: 12 * 60 })).toBe("Seulement aujourd'hui.");
    expect(motifPlatDuJour({ ...midi, service: "soir" }, { date: "2026-11-17", minutes: 12 * 60 })).toBe("Seulement le soir.");
    expect(motifPlatDuJour({ ...midi, service: "journee" }, { date: "2026-11-17", minutes: 19 * 60 })).toBeNull();
  });

  it("sur le serveur, le service vient des horaires, pas de l'heure de bascule", () => {
    // Service de midi prolongé jusqu'à 15h30 : une remise à 15h15 reste « midi ».
    const horaires = [
      { jour: 2, service: "midi", premiere_heure: "11:45", derniere_heure: "15:30", derniere_commande: "15:00", derniere_commande_pizzas: "15:00" },
      { jour: 2, service: "soir", premiere_heure: "18:45", derniere_heure: "22:45", derniere_commande: "21:30", derniere_commande_pizzas: "22:15" },
    ] as Parameters<typeof serviceHoraire>[0]["horaires"];
    // 17.11.2026 est un mardi (jour 2).
    expect(serviceHoraire({ horaires }, "2026-11-17", 15 * 60 + 15)).toBe("midi");
    expect(serviceHoraire({ horaires }, "2026-11-17", 19 * 60)).toBe("soir");
    expect(serviceHoraire({ horaires }, "2026-11-17", 16 * 60)).toBeNull();
    const midi = { date: "2026-11-17", service: "midi" as const };
    expect(motifPlatDuJour(midi, { date: "2026-11-17", minutes: 15 * 60 + 15, service: "midi" })).toBeNull();
    expect(motifPlatDuJour(midi, { date: "2026-11-17", minutes: 15 * 60 + 15 })).toBe("Seulement à midi.");
  });

  it("le panier dit quel plat du jour ne va pas avec l'heure choisie", () => {
    const cat = {
      plats: {
        osso: { slug: "osso", nom: "Osso buco", jour: { date: "2026-11-17", service: "midi" } },
        margherita: { slug: "margherita", nom: "Margherita", jour: null },
      },
      groupes: {},
      tauxTvaPourcent: 2.6,
    } as unknown as Catalogue;
    expect(erreurPlatsDuJour(cat, [{ slug: "margherita" }, { slug: "osso" }], { date: "2026-11-17", minutes: 19 * 60 })).toBe("Osso buco : seulement à midi.");
    expect(erreurPlatsDuJour(cat, [{ slug: "osso" }], { date: "2026-11-17", minutes: 12 * 60 })).toBeNull();
    expect(erreurPlatsDuJour(cat, [{ slug: "__proto__" }], { date: "2026-11-17", minutes: 12 * 60 })).toBeNull();
    expect(momentDuChoix({ type: "asap" }, 735, "2026-11-17")).toEqual({ date: "2026-11-17", minutes: 735 });
    expect(momentDuChoix({ type: "creneau", date: "2026-11-18", minutes: 1170 }, undefined, "2026-11-17")).toEqual({ date: "2026-11-18", minutes: 1170 });
  });
});

describe("photo envoyée", () => {
  const image = (largeur: number, hauteur: number) =>
    sharp({ create: { width: largeur, height: hauteur, channels: 3, background: { r: 120, g: 110, b: 100 } } });

  it("recadre en 4:3 et réduit à 2133 × 1600, en JPEG", async () => {
    const r = await preparerPhoto(await image(4032, 3024).jpeg().toBuffer());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.photo.largeur, r.photo.hauteur]).toEqual([2133, 1600]);
    const m = await sharp(r.photo.donnees).metadata();
    expect([m.format, m.width, m.height]).toEqual(["jpeg", 2133, 1600]);
  });

  it("une photo en hauteur (téléphone) est recadrée en 4:3 couché", async () => {
    const r = await preparerPhoto(await image(3024, 4032).png().toBuffer());
    expect(r.ok && [r.photo.largeur, r.photo.hauteur]).toEqual([2133, 1600]);
  });

  it("garde une photo moyenne à sa taille, sans l'agrandir", async () => {
    const r = await preparerPhoto(await image(1600, 1200).webp().toBuffer());
    expect(r.ok && [r.photo.largeur, r.photo.hauteur]).toEqual([1600, 1200]);
  });

  it("efface les métadonnées (lieu GPS, appareil)", async () => {
    const avec = await image(2400, 1800).withExif({ IFD0: { Make: "AppareilTest", Model: "X" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "46/1 11/1 0/1" } }).jpeg().toBuffer();
    expect((await sharp(avec).metadata()).exif).toBeDefined();
    const r = await preparerPhoto(avec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.photo.donnees).metadata();
    expect(m.exif).toBeUndefined();
    expect(r.photo.donnees.includes(Buffer.from("AppareilTest"))).toBe(false);
  });

  it("refuse trop petit, trop lourd, faux format, contenu déguisé", async () => {
    expect(await preparerPhoto(await image(1000, 750).jpeg().toBuffer())).toMatchObject({ ok: false, erreur: expect.stringContaining("trop petite") });
    // 1200 de large mais 600 de haut : le recadrage 4:3 donne 800 × 600.
    expect(await preparerPhoto(await image(1200, 600).jpeg().toBuffer())).toMatchObject({ ok: false });
    expect(await preparerPhoto(new Uint8Array(6 * 1024 * 1024))).toMatchObject({ ok: false, erreur: expect.stringContaining("trop lourde") });
    expect(await preparerPhoto(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toMatchObject({ ok: false, erreur: expect.stringContaining("Format") });
    const gif = new TextEncoder().encode("GIF89a");
    expect(await preparerPhoto(gif)).toMatchObject({ ok: false });
    // En-tête JPEG suivi de n'importe quoi : illisible.
    const faux = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("pas une image du tout")]);
    expect(await preparerPhoto(faux)).toMatchObject({ ok: false });
    expect(await preparerPhoto(new Uint8Array())).toMatchObject({ ok: false, erreur: "Fichier vide." });
  });

  it("reconnaît le format aux premiers octets", async () => {
    expect(formatDe(await image(10, 10).jpeg().toBuffer())).toBe("jpeg");
    expect(formatDe(await image(10, 10).png().toBuffer())).toBe("png");
    expect(formatDe(await image(10, 10).webp().toBuffer())).toBe("webp");
    expect(formatDe(await image(16, 16).avif().toBuffer())).toBe("avif");
    expect(formatDe(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});
