import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { platDuFichier } from "@/lib/photos-lot";
import { preparerPhoto } from "@/lib/photo-envoi";

// Plusieurs photos d'un coup : le plat trouvé d'après le nom du fichier, et le cadrage du recadrage 4:3.

const PLATS = [
  { slug: "pizza-tonno", nom: "Pizza Tonno" },
  { slug: "pizza-tonno-grande", nom: "Pizza Tonno grande" },
  { slug: "tiramisu", nom: "Tiramisu" },
  { slug: "risotto-saint-jacques", nom: "Risotto aux Saint-Jacques" },
];

describe("plat d'après le nom du fichier", () => {
  it("slug, nom avec majuscules et accents, nom contenu, rien", () => {
    expect(platDuFichier("pizza-tonno.jpg", PLATS)).toBe("pizza-tonno");
    expect(platDuFichier("Pizza Tonno grande.PNG", PLATS)).toBe("pizza-tonno-grande");
    expect(platDuFichier("Risotto aux Saint-Jacques.jpeg", PLATS)).toBe("risotto-saint-jacques");
    expect(platDuFichier("IMG_2041-tiramisu-2.jpg", PLATS)).toBe("tiramisu");
    expect(platDuFichier("photo-pizza-tonno-grande-2.jpg", PLATS)).toBe("pizza-tonno-grande");
    expect(platDuFichier("IMG_2041.jpg", PLATS)).toBe("");
  });
});

describe("cadrage", () => {
  // Photo haute (2400 × 3600) : moitié haute blanche, moitié basse noire. Le recadrage 4:3 garde le haut,
  // le centre ou le bas : le pixel du milieu dit lequel.
  async function photoHaute() {
    const blanc = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
    return sharp({ create: { width: 2400, height: 3600, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: blanc, top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
  }
  async function centre(cadrage: "haut" | "bas") {
    const r = await preparerPhoto(new Uint8Array(await photoHaute()), cadrage);
    if (!r.ok) throw new Error(r.erreur);
    const { data, info } = await sharp(r.photo.donnees).raw().toBuffer({ resolveWithObject: true });
    return data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels];
  }
  it("haut garde le haut, bas garde le bas", async () => {
    expect(await centre("haut")).toBeGreaterThan(200);
    expect(await centre("bas")).toBeLessThan(50);
  });
});
