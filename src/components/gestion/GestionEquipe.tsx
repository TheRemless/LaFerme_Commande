"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";

// L'équipe (audit du gérant, G03) : qui peut se connecter à la tablette, qui au back-office.
// Retirer coupe l'accès tout de suite. Il reste toujours au moins un gérant (contrôlé en base).

type Membre = { id: string; email: string; nom: string; role: "service" | "gerant" | "livreur"; actif: boolean; sessions: number; derniere_connexion: string | null };

const ROLES = { service: "Tablette", gerant: "Tablette et back-office", livreur: "Livreur (ses livraisons sur son téléphone)" } as const;

export function GestionEquipe() {
  const ids = useId();
  const [d, setD] = useState<{ moi: string; liste: Membre[] } | null>(null);
  const [nouveau, setNouveau] = useState({ email: "", nom: "", role: "service" as Membre["role"] });
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [confirmer, setConfirmer] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    const rep = await fetch("/api/gestion/personnel", { cache: "no-store" });
    if (rep.ok) setD(await rep.json());
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function agir(corps: Record<string, unknown>): Promise<boolean> {
    setEnvoi(true);
    setMessage(null);
    const r = await poster("/api/gestion/personnel", corps);
    setMessage({ ok: r.ok, texte: String(r.donnees.message ?? r.donnees.erreur ?? (r.ok ? "Enregistré." : "Pas enregistré.")) });
    setConfirmer(null);
    await charger();
    setEnvoi(false);
    return r.ok;
  }

  if (!d) return <p className="aide">Chargement…</p>;
  const actifs = d.liste.filter((m) => m.actif);
  const retires = d.liste.filter((m) => !m.actif);

  return (
    <div className="ges-service">
      <section className="ges-bloc">
        <h2>Équipe</h2>
        <p>Chacun se connecte avec son adresse e-mail et le code à 8 chiffres qu&apos;il reçoit. Retirer quelqu&apos;un coupe son accès tout de suite.</p>
        {message && (
          <p className={message.ok ? "tab-message" : "panier-alerte"} role={message.ok ? "status" : "alert"}>
            {message.texte}
          </p>
        )}
        <ul className="ges-fermetures ges-equipe">
          {actifs.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.nom}</strong>
                {m.id === d.moi ? " (vous)" : ""}
                <br />
                {m.email}
                <br />
                <span className="aide">
                  {m.sessions ? `Connecté sur ${m.sessions} appareil${m.sessions > 1 ? "s" : ""}` : "Pas connecté"}
                  {m.derniere_connexion ? `. Dernière connexion le ${jourTexte(jourGeneveDe(m.derniere_connexion))} à ${heureDe(m.derniere_connexion)}.` : "."}
                </span>
              </div>
              <div className="ges-equipe-actions">
                <label className="sr-only" htmlFor={`${ids}-role-${m.id}`}>
                  Accès de {m.nom}
                </label>
                <select id={`${ids}-role-${m.id}`} value={m.role} disabled={envoi || m.id === d.moi} onChange={(e) => agir({ action: "modifier", id: m.id, role: e.target.value })}>
                  <option value="service">{ROLES.service}</option>
                  <option value="gerant">{ROLES.gerant}</option>
                  <option value="livreur">{ROLES.livreur}</option>
                </select>
                {m.sessions > 0 && (
                  <button type="button" className="lien" disabled={envoi} onClick={() => agir({ action: "couper", id: m.id })}>
                    Déconnecter partout
                  </button>
                )}
                {m.id === d.moi ? null : confirmer === m.id ? (
                  <span className="boutons-ligne">
                    <button type="button" className="bouton-second" disabled={envoi} onClick={() => agir({ action: "modifier", id: m.id, actif: false })}>
                      Oui, retirer {m.nom}
                    </button>
                    <button type="button" className="lien" onClick={() => setConfirmer(null)}>
                      Garder
                    </button>
                  </span>
                ) : (
                  <button type="button" className="lien" disabled={envoi} onClick={() => setConfirmer(m.id)}>
                    Retirer
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="ges-bloc">
        <h2>Ajouter quelqu&apos;un</h2>
        <form
          className="details"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await agir({ action: "ajouter", ...nouveau })) setNouveau({ email: "", nom: "", role: "service" });
          }}
        >
          <div className="champ">
            <label htmlFor={`${ids}-nom`}>Prénom</label>
            <input id={`${ids}-nom`} required maxLength={60} autoComplete="off" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-email`}>E-mail</label>
            <input id={`${ids}-email`} type="email" required maxLength={120} autoComplete="off" value={nouveau.email} onChange={(e) => setNouveau({ ...nouveau, email: e.target.value })} />
          </div>
          <div className="champ">
            <label htmlFor={`${ids}-role`}>Accès</label>
            <select id={`${ids}-role`} value={nouveau.role} onChange={(e) => setNouveau({ ...nouveau, role: e.target.value as Membre["role"] })}>
              <option value="service">{ROLES.service}</option>
              <option value="gerant">{ROLES.gerant}</option>
              <option value="livreur">{ROLES.livreur}</option>
            </select>
          </div>
          <button type="submit" className="bouton-principal champ-large" disabled={envoi}>
            Ajouter
          </button>
        </form>
      </section>

      {retires.length > 0 && (
        <section className="ges-bloc">
          <h2>Anciens membres</h2>
          <ul className="ges-fermetures">
            {retires.map((m) => (
              <li key={m.id}>
                <span>
                  {m.nom}, {m.email}
                </span>
                <button type="button" className="lien" disabled={envoi} onClick={() => agir({ action: "ajouter", email: m.email, nom: m.nom, role: m.role })}>
                  Remettre
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
