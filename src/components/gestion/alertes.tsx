"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { PanneauLateral } from "@/components/gestion/ui/PanneauLateral";
import { useRelecture, type Relecture } from "@/components/gestion/ui/useRelecture";
import type { Alerte, DonneesAccueil } from "@/lib/accueil-gestion";
import { aNotifier, lirePreferences, PREFERENCES_PAR_DEFAUT, titreAvecCompteur, TYPES_ALERTE, type PreferencesAlertes, type TypeAlerte } from "@/lib/alertes-types";

// Centre d'alertes du back-office (vague 3, bo-socle). Une seule lecture de l'accueil pour toute la coque,
// toutes les 20 secondes, même onglet caché : l'accueil l'affiche, et sur toutes les pages le nombre d'alertes
// passe dans le titre de l'onglet et sur « Accueil » dans le menu. Une alerte nouvelle d'un type choisi
// déclenche une notification du navigateur, si le gérant l'a demandée sur cet appareil.
// Scène : Giuseppe en salle, le back-office ouvert sur la caisse, la tablette ne répond plus.

export type ReponseAccueil = DonneesAccueil & { alertes: Alerte[] };
type Permission = NotificationPermission | "indisponible";

type Contexte = {
  lecture: Relecture<ReponseAccueil>;
  prefs: PreferencesAlertes;
  changerPrefs: (p: PreferencesAlertes) => void;
  permission: Permission;
  /** Demande l'autorisation au navigateur (seulement sur un geste du gérant). */
  demanderPermission: () => Promise<Permission>;
};

const Ctx = createContext<Contexte | null>(null);
const CLE_PREFS = "laferme.gestion.alertes";
const RELECTURE_MS = 20_000;

/** null hors du fournisseur, ou quand il est éteint (responsable : l'accueil est réservé au gérant). */
export const useAlertes = () => useContext(Ctx);

const permissionActuelle = (): Permission => (typeof window !== "undefined" && "Notification" in window ? Notification.permission : "indisponible");

export function FournisseurAlertes({ actif, children }: { actif: boolean; children: React.ReactNode }) {
  const chemin = usePathname();
  const router = useRouter();
  const lecture = useRelecture<ReponseAccueil>(
    async (signal) => {
      const r = await fetch("/api/gestion/accueil", { cache: "no-store", signal });
      if (r.status === 401) {
        window.location.reload();
        throw new Error("Session terminée.");
      }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    [],
    { intervalleMs: RELECTURE_MS, actif, arrierePlan: true, messageErreur: "Les chiffres du jour n'ont pas pu être chargés." },
  );
  const [prefs, setPrefs] = useState<PreferencesAlertes>(PREFERENCES_PAR_DEFAUT);
  const [permission, setPermission] = useState<Permission>("indisponible");
  useEffect(() => {
    setPermission(permissionActuelle());
    try {
      setPrefs(lirePreferences(JSON.parse(localStorage.getItem(CLE_PREFS) ?? "null")));
    } catch {}
  }, []);
  const changerPrefs = useCallback((p: PreferencesAlertes) => {
    setPrefs(p);
    try {
      localStorage.setItem(CLE_PREFS, JSON.stringify(p));
    } catch {}
  }, []);
  const demanderPermission = useCallback(async () => {
    if (permissionActuelle() === "indisponible") return "indisponible";
    const p = await Notification.requestPermission();
    setPermission(p);
    return p;
  }, []);

  const alertes = lecture.donnees?.alertes ?? null;
  const n = alertes?.length ?? 0;

  // Compteur dans le titre de l'onglet. Next.js réécrit le titre à chaque page : on le remet après lui.
  useEffect(() => {
    if (!actif) return;
    const poser = () => {
      const t = titreAvecCompteur(document.title, n);
      if (t !== document.title) document.title = t;
    };
    poser();
    const obs = new MutationObserver(poser);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      obs.disconnect();
      document.title = titreAvecCompteur(document.title, 0);
    };
  }, [actif, n, chemin]);

  // Notifications : seulement ce qui apparaît après la première lecture (le reste est déjà à l'écran), pas
  // quand l'accueil est sous les yeux. Une alerte réglée puis revenue prévient de nouveau.
  const vues = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!alertes) return;
    const avant = vues.current;
    vues.current = new Set(alertes.map((a) => a.cle));
    if (!avant || permissionActuelle() !== "granted") return;
    if (chemin === "/gestion" && document.visibilityState === "visible") return;
    for (const a of aNotifier(alertes, avant, prefs)) {
      try {
        const notif = new Notification(a.titre, { body: a.detail ?? "", tag: `laferme-${a.cle}`, lang: "fr" });
        notif.onclick = () => {
          window.focus();
          router.push("/gestion");
          notif.close();
        };
      } catch {}
    }
    // prefs et chemin lus au moment de la lecture : pas de notification rejouée quand ils changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertes]);

  return <Ctx.Provider value={actif ? { lecture, prefs, changerPrefs, permission, demanderPermission } : null}>{children}</Ctx.Provider>;
}

/** Réglages des alertes, propres à cet appareil (stockage du navigateur) : rien ne part vers le serveur. */
export function ReglagesAlertes({ onFermer }: { onFermer: () => void }) {
  const ctx = useAlertes();
  const [essai, setEssai] = useState<string | null>(null);
  if (!ctx) return null;
  const { prefs, changerPrefs, permission, demanderPermission } = ctx;

  async function basculer(oui: boolean) {
    if (!oui) return changerPrefs({ ...prefs, notifier: false });
    const p = permission === "granted" ? permission : await demanderPermission();
    changerPrefs({ ...prefs, notifier: p === "granted" });
  }
  function essayer() {
    try {
      new Notification("Essai : alerte du back-office", { body: "Les alertes choisies arriveront comme celle-ci.", lang: "fr" });
      setEssai("Notification envoyée. Si rien ne s'affiche, vérifiez les notifications du système.");
    } catch {
      setEssai("Ce navigateur n'affiche pas les notifications de ce site.");
    }
  }
  const cocher = (t: TypeAlerte, oui: boolean) => changerPrefs({ ...prefs, types: { ...prefs.types, [t]: oui } });

  return (
    <PanneauLateral titre="Alertes sur cet appareil" onFermer={onFermer}>
      <div className="bo-reglages-alertes">
        <p>Sur toutes les pages du back-office, le nombre d&apos;alertes s&apos;affiche dans le titre de l&apos;onglet et sur « Accueil » dans le menu.</p>
        {permission === "indisponible" ? (
          <p className="aide">Ce navigateur ne propose pas de notifications.</p>
        ) : (
          <>
            <label className="bo-case">
              <input type="checkbox" checked={prefs.notifier && permission === "granted"} onChange={(e) => basculer(e.target.checked)} />
              <span>Me prévenir par une notification</span>
            </label>
            {permission === "denied" && (
              <p className="bo-alerte-refus" role="alert">
                Le navigateur bloque les notifications de ce site. Autorisez-les dans ses réglages puis cochez de nouveau.
              </p>
            )}
            <fieldset className="bo-alertes-types" disabled={!prefs.notifier || permission !== "granted"}>
              <legend>Me prévenir pour</legend>
              {TYPES_ALERTE.map((t) => (
                <label key={t.type} className="bo-case">
                  <input type="checkbox" checked={prefs.types[t.type]} onChange={(e) => cocher(t.type, e.target.checked)} />
                  <span>{t.libelle}</span>
                </label>
              ))}
            </fieldset>
            {prefs.notifier && permission === "granted" && (
              <button type="button" className="bo-bouton bo-bouton-second" onClick={essayer}>
                Envoyer une notification d&apos;essai
              </button>
            )}
            {essai && (
              <p className="aide" role="status">
                {essai}
              </p>
            )}
          </>
        )}
        <p className="aide">Le back-office doit rester ouvert dans un onglet. Ce réglage ne vaut que pour cet appareil.</p>
      </div>
    </PanneauLateral>
  );
}
