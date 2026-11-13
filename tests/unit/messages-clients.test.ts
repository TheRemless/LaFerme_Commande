import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { lireMessages, messagesVisibles, type MessageClient } from "@/lib/messages-clients";

const M = (x: Partial<MessageClient>): MessageClient => ({ id: 1, texte: "Fermé ce soir.", debut: "2026-11-20T10:00:00.000Z", fin: "2026-11-20T22:00:00.000Z", emplacement: "accueil", ...x });

describe("messagesVisibles", () => {
  const midi = new Date("2026-11-20T11:00:00Z").getTime();
  it("dans sa fenêtre, à la minute près", () => {
    expect(messagesVisibles([M({})], "accueil", midi)).toHaveLength(1);
    expect(messagesVisibles([M({})], "accueil", new Date("2026-11-20T09:59:00Z").getTime())).toEqual([]);
    expect(messagesVisibles([M({})], "accueil", new Date("2026-11-20T22:00:00Z").getTime())).toEqual([]);
  });
  it("« accueil » sur l'accueil seulement, « partout » sur toutes les pages", () => {
    expect(messagesVisibles([M({})], "panier", midi)).toEqual([]);
    expect(messagesVisibles([M({ emplacement: "partout" })], "paiement", midi)).toHaveLength(1);
    expect(messagesVisibles(undefined, "accueil", midi)).toEqual([]);
  });
});

describe("lireMessages", () => {
  it("garde les messages lisibles, dates en texte ISO", () => {
    expect(lireMessages([{ id: 1, texte: "Ok.", debut: new Date("2026-11-20T10:00:00Z"), fin: "2026-11-20T22:00:00Z", emplacement: "accueil" }])).toEqual([M({ texte: "Ok." })]);
    expect(lireMessages([{ id: "1", texte: "x" }, null, { id: 2, texte: "y", debut: "n", fin: "n", emplacement: "accueil" }])).toEqual([]);
    expect(lireMessages(null)).toEqual([]);
  });
});

describe("config du service", () => {
  afterAll(async () => {
    await (await baseLocale()).query("delete from messages_clients where texte = 'Test de la config.'");
  });
  it("porte les messages programmés, sans nom", async () => {
    const db = await baseLocale();
    await db.query(
      "insert into messages_clients (texte, debut, fin, emplacement, cree_par) values ('Test de la config.', now() - interval '1 minute', now() + interval '1 hour', 'partout', 'Gérant secret')",
    );
    const { chargerConfigService } = await import("@/lib/config-service");
    const c = await chargerConfigService();
    expect(c.messages?.map((m) => m.texte)).toContain("Test de la config.");
    expect(JSON.stringify(c)).not.toContain("Gérant secret");
  });
});
