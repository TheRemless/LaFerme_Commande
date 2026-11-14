"use client";

import { useCallback, useEffect, useState } from "react";
import { heureDe as heure } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { nomCourt, type Station, type VuePoste as Vue } from "@/components/tablette/poste";
import { Decaler } from "@/components/tablette/Decaler";

// Vue par poste (vague 3, décision D12 à l'essai) : un écran au poste pizza ou cuisine, lisible à un mètre. Les
// tickets continuent de sortir. En haut, ce qui reste à sortir par plat ; au milieu, les commandes dans l'ordre des
// tickets ; en bas, les dernières sorties, rouvrables en cas d'erreur de doigt.

const RELECTURE_MS = 5000;
const TITRE: Record<Station, string> = { pizza: "Poste pizza", cuisine: "Poste cuisine" };

export function VuePoste({ station }: { station: Station }) {
  const [vue, setVue] = useState<(Vue & { maintenant: string }) | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const rep = await fetch(`/api/tablette/poste?station=${station}`, { cache: "no-store" });
      if (rep.status === 401) return window.location.assign("/tablette");
      if (!rep.ok) throw new Error(String(rep.status));
      setVue(await rep.json());
      setHorsLigne(false);
    } catch {
      setHorsLigne(true);
    }
  }, [station]);
  useEffect(() => {
    charger();
    const t = window.setInterval(charger, RELECTURE_MS);
    return () => window.clearInterval(t);
  }, [charger]);

  async function geste(commande: string, g: "lancer" | "pret" | "rouvrir") {
    setEnvoi(`${commande}:${g}`);
    setErreur(null);
    const r = await poster("/api/tablette/poste", { commande, station, geste: g });
    if (!r.ok) setErreur(String(r.donnees.erreur ?? "Pas enregistré. Réessayez."));
    await charger();
    setEnvoi(null);
  }

  const maintenant = vue ? new Date(vue.maintenant).getTime() : Date.now();
  const depuis = (iso: string) => Math.max(0, Math.floor((maintenant - new Date(iso).getTime()) / 60_000));

  return (
    <div className="poste">
      <header className="poste-tete">
        <h1>{TITRE[station]}</h1>
        <p aria-live="polite">
          {vue === null ? "Chargement…" : vue.en_cours.length === 0 ? "Rien à sortir." : `${vue.en_cours.length} en cours`}
          {vue && vue.plus_tard > 0 ? `, ${vue.plus_tard} plus tard (elles arrivent ici à la sortie de leurs tickets)` : ""}
        </p>
        <a className="bouton-second" href="/tablette">
          Tablette
        </a>
      </header>
      {vue && vue.en_cours.length > 0 && <Decaler station={station} onChange={charger} />}

      {horsLigne && (
        <p className="tab-alerte" role="alert">
          Pas de connexion. Les tickets papier restent la référence.
        </p>
      )}
      {erreur && (
        <p className="tab-alerte" role="alert">
          {erreur}
        </p>
      )}

      {vue && vue.reste.length > 0 && (
        <section className="poste-reste" aria-label="Reste à sortir">
          <h2>Reste à sortir</h2>
          <ul>
            {vue.reste.map((r) => (
              <li key={r.nom}>
                <strong>{r.qte}</strong> {nomCourt(r.nom, station)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vue && (
        <ol className="poste-file" aria-label="Commandes en cours">
          {vue.en_cours.map((c) => {
            const retard = new Date(c.heure).getTime() < maintenant;
            return (
              <li key={c.id} className={`poste-commande${retard ? " poste-retard" : ""}`}>
                <div className="poste-commande-tete">
                  <p className="poste-num">{c.numero}</p>
                  <p className="poste-quand">
                    <strong>{c.mode === "livraison" ? "Livraison" : "À emporter"}</strong> {heure(c.heure)}
                    <br />
                    {retard ? <span className="poste-retard-texte">En retard</span> : <>Reçue il y a {depuis(c.a_faire_le)} min</>}
                  </p>
                </div>
                {c.allergie && <p className="poste-allergie">Allergie : {c.allergie}</p>}
                <ul className="poste-lignes">
                  {c.lignes.map((l, i) => (
                    <li key={i}>
                      <span className="poste-qte">{l.qte}</span>
                      <span>
                        {nomCourt(l.nom, station)}
                        {l.pour?.trim() && <span className="poste-pour">pour {l.pour.trim()}</span>}
                        {l.details.map((d) => (
                          <span key={d} className={d.startsWith("«") ? "poste-note" : "poste-detail"}>
                            {d}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="poste-client">{c.client}</p>
                <div className="poste-gestes">
                  {c.lance_le ? (
                    <span className="poste-lancee">Lancée à {heure(c.lance_le)}</span>
                  ) : (
                    <button type="button" className="bouton-second" disabled={envoi !== null} onClick={() => geste(c.id, "lancer")}>
                      Lancée
                    </button>
                  )}
                  <button type="button" className="bouton-principal" disabled={envoi !== null} onClick={() => geste(c.id, "pret")}>
                    Prête
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {vue && vue.sorties.length > 0 && (
        <section className="poste-sorties" aria-label="Dernières sorties">
          <h2>Dernières sorties</h2>
          <ul>
            {vue.sorties.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.numero}</strong> à {heure(s.pret_le)}
                  {s.par_le_poste ? "" : ", au comptoir"}
                </span>
                {s.rouvrable && s.par_le_poste && (
                  <button type="button" className="bouton-second" disabled={envoi !== null} onClick={() => geste(s.id, "rouvrir")}>
                    Rouvrir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
