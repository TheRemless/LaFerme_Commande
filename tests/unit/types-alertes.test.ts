import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// alerter() et les types d'alertes : un type coupé n'envoie rien, mais la copie reste en base.

const { alerter } = await import("@/lib/surveillance");
const { alerteActive } = await import("@/lib/alertes-types");

afterAll(async () => {
  const db = await baseLocale();
  await db.query("update types_alertes set actif = true where cle = 'reclamation'");
});

async function derniere(sujet: string) {
  const db = await baseLocale();
  return (await db.query<{ fournisseur: string }>("select fournisseur from courriels where sujet = $1 order by envoye_le desc limit 1", [sujet])).rows[0];
}

describe("alerter par type", () => {
  it("type envoyé : comme avant ; type coupé : copie gardée, fournisseur « desactivee »", async () => {
    const db = await baseLocale();
    expect(await alerteActive("reclamation")).toBe(true);
    const a = `Essai type actif ${Date.now()}`;
    await alerter(a, ["ligne"], "alerte", "reclamation");
    expect((await derniere(a))?.fournisseur).toBe("doublure");
    await db.query("update types_alertes set actif = false where cle = 'reclamation'");
    expect(await alerteActive("reclamation")).toBe(false);
    const b = `Essai type coupé ${Date.now()}`;
    await alerter(b, ["ligne"], "alerte", "reclamation");
    expect((await derniere(b))?.fournisseur).toBe("desactivee");
    // Sans type : toujours envoyée.
    const c = `Essai sans type ${Date.now()}`;
    await alerter(c, ["ligne"]);
    expect((await derniere(c))?.fournisseur).toBe("doublure");
  });
});
