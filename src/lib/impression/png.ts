import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { svgTicket, type LigneTicket } from "@/lib/impression/ticket";

// Image PNG du ticket pour l'imprimante (CloudPRNT image/png, imprimée telle quelle par le mC-Print3).
// Police DejaVu Sans Condensed (licence Bitstream Vera, libre d'emploi) : accents et « œ » compris,
// sans dépendre de la page de codes de l'imprimante.

const RACINE = process.cwd();
let pret: Promise<{ polices: Uint8Array[] }> | null = null;

function charger() {
  pret ??= (async () => {
    await initWasm(await readFile(path.join(RACINE, "node_modules/@resvg/resvg-wasm/index_bg.wasm")));
    const polices = await Promise.all(
      ["DejaVuSansCondensed.ttf", "DejaVuSansCondensed-Bold.ttf"].map(async (f) => new Uint8Array(await readFile(path.join(RACINE, "node_modules/dejavu-fonts-ttf/ttf", f)))),
    );
    return { polices };
  })().catch((e) => {
    pret = null;
    throw e;
  });
  return pret;
}

export async function pngTicket(lignes: LigneTicket[]): Promise<Uint8Array> {
  const { polices } = await charger();
  const rendu = new Resvg(svgTicket(lignes), {
    font: { fontBuffers: polices, defaultFontFamily: "DejaVu Sans Condensed", loadSystemFonts: false },
    background: "#ffffff",
  });
  return rendu.render().asPng();
}
