import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { appliquerRemise, codesActifs, codeTape, evaluerCode, messageCode } from "@/lib/code-promo";

// Vague 3, client-commande : branchement des codes promo de bo-carte, éteints par défaut.
// Code et taux d'essai, créés ici : aucune offre réelle (décision C2 de Jérémy).

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
process.env.SANS_LIMITE_COMPTOIR = "1";

async function commander(code: string | undefined, email = `code-${randomUUID().slice(0, 8)}@laferme.test`) {
  const { POST } = await import("@/app/api/commandes/route");
  return POST(
    new Request("http://localhost:3000/api/commandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cle: randomUUID(),
        lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }],
        mode: "retrait",
        quand: { type: "asap" },
        heure: "2026-11-10T19:05",
        client: { prenom: "Test", nom: "Code", telephone: `079 ${100 + Math.floor(Math.random() * 899)} 00 00`, email },
        moyen: "comptoir",
        code,
      }),
    }),
  );
}

type CommandeLue = { erreur?: string; id?: string; sous_total_centimes: number; total_centimes: number; tva_centimes: number; remise: number | null };
async function commandeDe(rep: Response): Promise<CommandeLue> {
  const r = (await rep.json()) as { redirection?: string; erreur?: string };
  if (!r.redirection) return { erreur: r.erreur } as CommandeLue;
  const db = await baseLocale();
  const c = (await db.query<{ id: string; sous_total_centimes: number; total_centimes: number; tva_centimes: number }>(
    "select id, sous_total_centimes, total_centimes, tva_centimes from commandes where jeton_suivi = $1",
    [r.redirection.split("/suivi/")[1]],
  )).rows[0];
  const u = (await db.query<{ remise_centimes: number }>("select remise_centimes from utilisations_codes where commande_id = $1", [c.id])).rows[0];
  return { ...c, remise: u?.remise_centimes ?? null };
}

async function regler(valeur: boolean) {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $1::jsonb where cle = 'codes_promo_actifs'", [JSON.stringify(valeur)]);
}

beforeAll(async () => {
  const db = await baseLocale();
  await db.query(
    "insert into codes_promo (code, libelle, type, valeur, minimum_centimes, une_fois_par_client, actif) values ('ESSAI-DIX', 'Essai', 'pourcentage', 10, 2000, true, true) on conflict (code) do nothing",
  );
});
afterAll(() => regler(false));

describe("codes promo côté client", () => {
  it("éteints par défaut : pas de champ, un code est refusé comme désactivé", async () => {
    expect(await codesActifs()).toBe(false);
    expect(await evaluerCode({ code: "ESSAI-DIX", mode: "retrait", sous_total_centimes: 5000, frais_centimes: 0, email: "a@exemple.test" })).toMatchObject({ ok: false, raison: "desactive" });
  });

  it("allumés : la base calcule la remise, le minimum a sa raison", async () => {
    await regler(true);
    expect(await codesActifs()).toBe(true);
    const ok = await evaluerCode({ code: "ESSAI-DIX", mode: "retrait", sous_total_centimes: 5000, frais_centimes: 0, email: "client@exemple.test", telephone: "079 000 00 00" });
    expect(ok).toEqual({ ok: true, code: "ESSAI-DIX", type: "pourcentage", remise_centimes: 500 });
    const trop = await evaluerCode({ code: "ESSAI-DIX", mode: "retrait", sous_total_centimes: 1500, frais_centimes: 0, email: "client@exemple.test" });
    expect(trop).toMatchObject({ ok: false, raison: "minimum", minimum_centimes: 2000 });
    if (!trop.ok) expect(messageCode(trop)).toBe("Ce code vaut dès CHF 20.00 de plats.");
  });

  it("au paiement : la remise baisse le total enregistré et l'utilisation est notée", async () => {
    await regler(true);
    const c = await commandeDe(await commander("essai-dix"));
    expect(c.remise).toBe(Math.round(c.sous_total_centimes / 10));
    expect(c.total_centimes).toBe(c.sous_total_centimes - c.remise!);
    expect(c.tva_centimes).toBe(Math.round((c.total_centimes * 2.6) / 102.6));
  });

  it("au paiement : même client, code déjà utilisé, refus nommé", async () => {
    await regler(true);
    const email = `fidele-${randomUUID().slice(0, 8)}@laferme.test`;
    await commander("ESSAI-DIX", email);
    expect((await commandeDe(await commander("ESSAI-DIX", email))).erreur).toBe("Vous avez déjà utilisé ce code.");
  });

  it("éteints : un code resté dans le navigateur est ignoré, la commande passe au plein prix", async () => {
    await regler(false);
    const c = await commandeDe(await commander("ESSAI-DIX"));
    expect(c.remise).toBeNull();
    expect(c.total_centimes).toBe(c.sous_total_centimes);
  });

  it("la forme du code : majuscules, 3 à 20 caractères", () => {
    expect(codeTape(" essai-dix ")).toBe("ESSAI-DIX");
    expect(codeTape("x")).toBeNull();
    expect(codeTape("<script>")).toBeNull();
  });

  it("la remise baisse le total et la TVA comprise suit", () => {
    expect(appliquerRemise({ total_centimes: 5000, tva_centimes: 127 }, 500, 2.6)).toEqual({ total_centimes: 4500, tva_centimes: 114, remise_centimes: 500 });
    expect(appliquerRemise({ total_centimes: 300, tva_centimes: 8 }, 500, 2.6).total_centimes).toBe(0);
  });
});
