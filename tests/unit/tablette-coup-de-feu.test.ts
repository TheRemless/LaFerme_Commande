import { afterEach, describe, expect, it, vi } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Coup de feu depuis la tablette (vague 3) : le gérant peut toujours ; l'équipe de service seulement quand
// coup_de_feu_par_equipe est vrai (construit désactivé). Le réglage est relu à chaque requête.

const session = vi.hoisted(() => ({ personnel: { id: "", email: "", nom: "", role: "gerant" as "gerant" | "service" } }));
vi.mock("@/lib/personnel/session", async (original) => ({
  ...(await original<typeof import("@/lib/personnel/session")>()),
  exigerPersonnel: async () => ({ personnel: session.personnel }),
}));
const { GET, POST } = await import("@/app/api/tablette/coup-de-feu/route");
const { resumeCoupDeFeu } = await import("@/components/tablette/rush");

async function membre(role: "gerant" | "service") {
  const db = await baseLocale();
  const email = `cdf-${role}-${Date.now()}@laferme.test`;
  const id = (await db.query<{ id: string }>("insert into personnel (email, nom, role, actif) values ($1, $2, $3, true) returning id", [email, `Cdf ${role}`, role])).rows[0].id;
  session.personnel = { id, email, nom: `Cdf ${role}`, role };
}
const poster = (corps: unknown) => POST(new Request("http://localhost/api/tablette/coup-de-feu", { method: "POST", body: JSON.stringify(corps) }));
const lancer = () => poster({ action: "lancer", retard_minutes: 20, duree_minutes: 60, livraison_fermee: false, capacite_livraison: 2, capacite_retrait: 2 });
const parEquipe = async (v: boolean) =>
  (await baseLocale()).query("update reglages set valeur = $1::jsonb where cle = 'coup_de_feu_par_equipe'", [JSON.stringify(v)]);

afterEach(async () => {
  await membre("gerant");
  await poster({ action: "finir" });
  await parEquipe(false);
});

describe("Coup de feu sur la tablette", () => {
  it("réglage présent et faux par défaut : l'équipe de service ne le voit pas et ne peut pas le lancer", async () => {
    const db = await baseLocale();
    const r = (await db.query<{ valeur: unknown; proposition: boolean }>("select valeur, proposition from reglages where cle = 'coup_de_feu_par_equipe'")).rows[0];
    expect(r).toMatchObject({ valeur: false, proposition: true });
    await membre("service");
    expect(((await (await GET(new Request("http://localhost/api/tablette/coup-de-feu"))).json()) as { autorise: boolean }).autorise).toBe(false);
    const refus = await lancer();
    expect(refus.status).toBe(403);
    expect(((await refus.json()) as { erreur: string }).erreur).toMatch(/gérant/);
  });

  it("le gérant lance puis finit ; l'équipe voit qu'il est en cours sans pouvoir le finir", async () => {
    await membre("gerant");
    const r = await lancer();
    expect(r.status).toBe(200);
    expect((await r.json()) as { en_cours: unknown }).toMatchObject({ en_cours: { applique: { retard_minutes: 20 } } });
    await membre("service");
    const vu = (await (await GET(new Request("http://localhost/api/tablette/coup-de-feu"))).json()) as { autorise: boolean; en_cours: unknown };
    expect(vu.autorise).toBe(false);
    expect(vu.en_cours).not.toBeNull();
    expect((await poster({ action: "finir" })).status).toBe(403);
    await membre("gerant");
    expect(((await (await poster({ action: "finir" })).json()) as { enregistre: boolean }).enregistre).toBe(true);
  });

  it("réglage à vrai : l'équipe de service lance ; remis à faux, refusé tout de suite", async () => {
    await parEquipe(true);
    await membre("service");
    expect((await lancer()).status).toBe(200);
    expect((await poster({ action: "finir" })).status).toBe(200);
    await parEquipe(false);
    expect((await lancer()).status).toBe(403);
  });

  it("résumé lisible du geste", () => {
    expect(resumeCoupDeFeu({ retard: 20, livraisons: 2, retraits: 2 })).toBe("+20 min sur les heures annoncées, 2 livraisons et 2 retraits par créneau");
    expect(resumeCoupDeFeu({ retraits: 1, fermee: true })).toBe("1 retrait par créneau, livraison fermée");
  });
});
