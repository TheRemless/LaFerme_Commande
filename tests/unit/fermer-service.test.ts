import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import type { Personnel } from "@/lib/personnel/session";

// Fermer le service du jour, côté serveur (src/lib/fermer-service.ts) : messages en français, aujourd'hui seulement.

const { fermerServiceDuJour } = await import("@/lib/fermer-service");
const MOTIF = "Essai serveur fermer-service";

async function personne(role: "gerant" | "service"): Promise<Personnel> {
  const db = await baseLocale();
  const email = `fs-serveur-${role}@laferme.test`;
  const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) on conflict (email) do update set actif = true returning id", [email, `Fs serveur ${role}`, role]);
  return { id: r.rows[0].id, email, nom: `Fs serveur ${role}`, role };
}

afterAll(async () => {
  const db = await baseLocale();
  await db.query("delete from fermetures where motif = $1", [MOTIF]);
});

describe("fermerServiceDuJour", () => {
  it("gérant : ferme ce soir, puis « déjà fermé » ; saisie et droits refusés en clair", async () => {
    const gerant = await personne("gerant");
    expect(await fermerServiceDuJour(gerant, "soir", MOTIF)).toMatchObject({ ok: true });
    expect(await fermerServiceDuJour(gerant, "soir", MOTIF)).toEqual({ ok: false, erreur: "C'est déjà fermé pour aujourd'hui.", code: undefined });
    expect(await fermerServiceDuJour(gerant, "demain", MOTIF)).toMatchObject({ ok: false, erreur: "Fermer : ce midi, ce soir ou toute la journée." });
    expect(await fermerServiceDuJour(gerant, "midi", "x")).toMatchObject({ ok: false });
    const service = await personne("service");
    expect(await fermerServiceDuJour(service, "midi", MOTIF)).toEqual({ ok: false, erreur: "Réservé au gérant ou au responsable de service.", code: 403 });
  });
});
