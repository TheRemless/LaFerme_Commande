"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Chargement, EtatErreur, EtatVide, PanneauLateral, useConfirmer, useNotifier } from "@/components/gestion/ui";
import { heureDe, jourGeneveDe } from "@/lib/heures";
import { poster } from "@/lib/requete-client";
import { jourTexte } from "@/lib/service";

// L'équipe (audit du gérant, G03) : qui peut se connecter à la tablette, qui au back-office.
// Retirer coupe l'accès tout de suite. Il reste toujours au moins un gérant (contrôlé en base).

type Membre = {
  id: string;
  email: string;
  nom: string;
  role: "service" | "gerant" | "livreur" | "responsable";
  actif: boolean;
  sessions: number;
  derniere_connexion: string | null;
  /** Dernier passage sur un de ses appareils (connexion ou activité). Absent avant la migration 20261212200000. */
  derniere_activite?: string | null;
};

// Libellés courts dans les listes (une liste longue débordait à 1280 px), le détail en aide sous la liste.
const ROLES = {
  service: "Tablette",
  responsable: "Responsable de service",
  gerant: "Tablette et back-office",
  livreur: "Livreur",
} as const;
const DETAIL_ROLES: Record<Membre["role"], string> = {
  service: "Accepte et suit les commandes sur la tablette.",
  responsable: "Tablette, remboursements et commandes passées.",
  gerant: "Tablette et tout le back-office.",
  livreur: "Ses livraisons sur son téléphone.",
};

/** « Connecté sur 2 appareils. Dernière activité le … » ; « Jamais connecté. » quand aucune session n'existe. */
function presence(m: Pick<Membre, "sessions" | "derniere_connexion" | "derniere_activite">): string {
  const vu = m.derniere_activite ?? m.derniere_connexion;
  if (!vu) return "Jamais connecté.";
  const etat = m.sessions ? `Connecté sur ${m.sessions} appareil${m.sessions > 1 ? "s" : ""}` : "Pas connecté";
  return `${etat}. Dernière activité le ${quand(vu)}.`;
}

export function GestionEquipe() {
  const ids = useId();
  const [d, setD] = useState<{ moi: string; liste: Membre[]; responsable_actif?: boolean } | null>(null);
  const [nouveau, setNouveau] = useState({ email: "", nom: "", role: "service" as Membre["role"] });
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [confirmer, setConfirmer] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [appareilsDe, setAppareilsDe] = useState<Membre | null>(null);

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
        <ul className="aide ges-roles">
          {(Object.keys(ROLES) as Membre["role"][])
            .filter((r) => r !== "responsable" || d.responsable_actif)
            .map((r) => (
              <li key={r}>
                <strong>{ROLES[r]}</strong> : {DETAIL_ROLES[r].charAt(0).toLowerCase() + DETAIL_ROLES[r].slice(1)}
              </li>
            ))}
        </ul>
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
                <span className="aide">{presence(m)}</span>
              </div>
              <div className="ges-equipe-actions">
                <label className="sr-only" htmlFor={`${ids}-role-${m.id}`}>
                  Accès de {m.nom}
                </label>
                <select id={`${ids}-role-${m.id}`} value={m.role} disabled={envoi || m.id === d.moi} onChange={(e) => agir({ action: "modifier", id: m.id, role: e.target.value })}>
                  <option value="service">{ROLES.service}</option>
                  {(d.responsable_actif || m.role === "responsable") && <option value="responsable">{ROLES.responsable}</option>}
                  <option value="gerant">{ROLES.gerant}</option>
                  <option value="livreur">{ROLES.livreur}</option>
                </select>
                {m.sessions > 0 && (
                  <>
                    <button type="button" className="lien" onClick={() => setAppareilsDe(m)}>
                      Appareils ({m.sessions})
                    </button>
                    <button type="button" className="lien" disabled={envoi} onClick={() => agir({ action: "couper", id: m.id })}>
                      Déconnecter partout
                    </button>
                  </>
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
            <select
              id={`${ids}-role`}
              aria-describedby={`${ids}-role-aide`}
              value={nouveau.role}
              onChange={(e) => setNouveau({ ...nouveau, role: e.target.value as Membre["role"] })}
            >
              <option value="service">{ROLES.service}</option>
              {d.responsable_actif && <option value="responsable">{ROLES.responsable}</option>}
              <option value="gerant">{ROLES.gerant}</option>
              <option value="livreur">{ROLES.livreur}</option>
            </select>
            <p id={`${ids}-role-aide`} className="aide">
              {DETAIL_ROLES[nouveau.role]}
            </p>
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
      {appareilsDe && (
        <AppareilsMembre
          membre={appareilsDe}
          fermer={() => {
            setAppareilsDe(null);
            charger();
          }}
        />
      )}
    </div>
  );
}

type Appareil = { id: string; appareil: string | null; cree_le: string; vue_le: string | null; expire_le: string; actuel: boolean };

const quand = (iso: string) => `${jourTexte(jourGeneveDe(iso))} à ${heureDe(iso)}`;

// Les appareils connectés d'un membre : une tablette volée ou le téléphone perdu d'un livreur se coupe seul,
// sans déconnecter les autres appareils (vague 3).
function AppareilsMembre({ membre, fermer }: { membre: Membre; fermer: () => void }) {
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const [liste, setListe] = useState<Appareil[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    const r = await poster("/api/gestion/personnel", { action: "appareils", id: membre.id });
    if (!r.ok) return setErreur(String(r.donnees.erreur ?? "Liste indisponible."));
    setErreur(null);
    setListe((r.donnees as { appareils: Appareil[] }).appareils);
  }, [membre.id]);
  useEffect(() => {
    charger();
  }, [charger]);

  async function couper(a: Appareil) {
    const nom = a.appareil ?? "cet appareil";
    const ok = await confirmer({
      titre: `Déconnecter ${nom} ?`,
      texte: a.actuel ? "C'est l'appareil que vous utilisez : vous devrez vous reconnecter avec un code." : `${membre.nom} devra se reconnecter avec un code sur cet appareil. Ses autres appareils restent connectés.`,
      oui: "Déconnecter",
      danger: true,
    });
    if (!ok) return;
    const r = await poster("/api/gestion/personnel", { action: "couper_appareil", session: a.id });
    notifier({ texte: String(r.donnees.message ?? r.donnees.erreur ?? (r.ok ? "Appareil déconnecté." : "Pas déconnecté.")), ton: r.ok ? "succes" : "erreur" });
    if (r.ok && a.actuel) return window.location.reload();
    await charger();
  }

  return (
    <PanneauLateral titre={`Appareils de ${membre.nom}`} sousTitre={membre.email} onFermer={fermer}>
      {erreur ? (
        <EtatErreur texte={erreur} reessayer={charger} />
      ) : !liste ? (
        <Chargement lignes={2} />
      ) : liste.length === 0 ? (
        <EtatVide titre="Plus aucun appareil connecté." />
      ) : (
        <ul className="ges-appareils">
          {liste.map((a) => (
            <li key={a.id}>
              <div>
                <strong>
                  {a.appareil ?? "Appareil"}
                  {a.actuel ? " (celui-ci)" : ""}
                </strong>
                <span className="aide">
                  Connecté le {quand(a.cree_le)}. {a.vue_le ? `Dernière activité le ${quand(a.vue_le)}.` : ""}
                </span>
              </div>
              <button type="button" className="bo-bouton bo-bouton-second bo-bouton-petit" onClick={() => couper(a)}>
                Déconnecter
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanneauLateral>
  );
}
