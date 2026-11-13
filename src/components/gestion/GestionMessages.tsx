"use client";

import { useCallback, useEffect, useState } from "react";
import { BarreEnregistrer, Champ, Chargement, EtatErreur, EtatVide, useConfirmer, useFormulaire, useNotifier } from "@/components/gestion/ui";
import { MESSAGE_A_COMPLETER, MODELES_MESSAGES, resteACompleter } from "@/lib/messages-modeles";
import { poster } from "@/lib/requete-client";
import { ajouterJours, depuisHeureGeneve, heureTexte, instantGeneve, jourTexte } from "@/lib/service";
import "./messages.css";

// Rubrique Messages aux clients du back-office (vague 3, bo-operations) : une bannière programmée sur le site,
// qui s'arrête seule. Route /api/gestion/messages (gérant), doc docs/messages-clients.md. L'affichage sur le
// site est fait par client-commande.

type Message = {
  id: number;
  texte: string;
  debut: string;
  fin: string;
  emplacement: "accueil" | "partout";
  cree_par: string;
  cree_le: string;
  retire_le: string | null;
};

const URL = "/api/gestion/messages";
const MAX_EN_COURS = 5;
const OU: Record<Message["emplacement"], string> = { accueil: "Accueil", partout: "Tout le site" };

// Jour à l'heure de Genève : « aujourd'hui », « demain » ou « dimanche 15 novembre ».
function jourDe(iso: string, maintenant = new Date()): string {
  const d = instantGeneve(new Date(iso)).date;
  const auj = instantGeneve(maintenant).date;
  return d === auj ? "aujourd'hui" : d === ajouterJours(auj, 1) ? "demain" : jourTexte(d);
}
const heureDe = (iso: string) => heureTexte(instantGeneve(new Date(iso)).minutes);
// « demain à 23h00 ».
const quand = (iso: string) => `${jourDe(iso)} à ${heureDe(iso)}`;
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
// « Dimanche 15 novembre de 11h00 à 23h00 », ou sur deux jours « Dès demain à 11h00, jusqu'à lundi 16 novembre à 23h00 ».
function plage(debut: string, fin: string): string {
  if (instantGeneve(new Date(debut)).date === instantGeneve(new Date(fin)).date) return majuscule(`${jourDe(debut)} de ${heureDe(debut)} à ${heureDe(fin)}`);
  return `Dès ${quand(debut)}, jusqu'à ${quand(fin)}`;
}

function etatDe(m: Message, maintenant: number): "en-cours" | "a-venir" | "fini" | "retire" {
  if (m.retire_le) return "retire";
  if (new Date(m.fin).getTime() <= maintenant) return "fini";
  return new Date(m.debut).getTime() > maintenant ? "a-venir" : "en-cours";
}

export function GestionMessages() {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Après un message programmé, le formulaire repart vide.
  const [formulaire, setFormulaire] = useState(0);

  const charger = useCallback(async () => {
    try {
      const r = await fetch(URL, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.erreur ?? "Messages indisponibles."));
      setMessages(d.messages ?? []);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Messages indisponibles.");
    }
  }, []);
  useEffect(() => {
    charger();
    // Un message commence ou finit seul : la liste se relit chaque minute.
    const t = window.setInterval(charger, 60_000);
    return () => window.clearInterval(t);
  }, [charger]);

  if (erreur && !messages) return <EtatErreur texte={erreur} reessayer={charger} />;
  if (!messages) return <Chargement libelle="Chargement des messages…" />;

  const maintenant = Date.now();
  const actifs = messages.filter((m) => ["en-cours", "a-venir"].includes(etatDe(m, maintenant))).sort((a, b) => a.debut.localeCompare(b.debut));
  const passes = messages.filter((m) => ["fini", "retire"].includes(etatDe(m, maintenant)));

  return (
    <div className="bo-msg">
      <section className="bo-msg-bloc" aria-labelledby="msg-actifs">
        <div className="bo-msg-tete">
          <h2 id="msg-actifs">Sur le site</h2>
          <p className="aide">
            {actifs.length} sur {MAX_EN_COURS} au plus
          </p>
        </div>
        {actifs.length === 0 ? (
          <EtatVide titre="Aucun message sur le site" texte="Programmez-en un ci-dessous : il s'affiche à l'heure choisie et s'arrête seul." />
        ) : (
          <ul className="bo-msg-liste">
            {actifs.map((m) => (
              <LigneMessage key={m.id} m={m} etat={etatDe(m, maintenant)} recharger={charger} />
            ))}
          </ul>
        )}
      </section>

      <section className="bo-msg-bloc" aria-labelledby="msg-nouveau">
        <h2 id="msg-nouveau">Programmer un message</h2>
        {actifs.length >= MAX_EN_COURS ? (
          <p className="aide">Cinq messages sont déjà prévus. Retirez-en un pour en programmer un autre.</p>
        ) : (
          <Programmer
            key={formulaire}
            apres={async () => {
              setFormulaire((n) => n + 1);
              await charger();
            }}
          />
        )}
      </section>

      {passes.length > 0 && (
        <section className="bo-msg-bloc" aria-labelledby="msg-passes">
          <h2 id="msg-passes">Les 30 derniers jours</h2>
          <ul className="bo-msg-liste bo-msg-liste-passes">
            {passes.map((m) => (
              <LigneMessage key={m.id} m={m} etat={etatDe(m, maintenant)} recharger={charger} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LigneMessage({ m, etat, recharger }: { m: Message; etat: ReturnType<typeof etatDe>; recharger: () => Promise<void> }) {
  const confirmer = useConfirmer();
  const notifier = useNotifier();
  const [envoi, setEnvoi] = useState(false);
  async function retirer() {
    const ok = await confirmer({
      titre: "Retirer ce message du site ?",
      texte: `« ${m.texte} » quitte le site en moins d'une minute. Pour le remettre, il faudra le programmer à nouveau.`,
      oui: "Retirer le message",
      danger: true,
    });
    if (!ok) return;
    setEnvoi(true);
    const r = await poster(URL, { type: "retirer", id: m.id });
    setEnvoi(false);
    if (!r.ok) return notifier({ texte: String(r.donnees.erreur ?? "Pas enregistré. Réessayez."), ton: "erreur" });
    notifier({ texte: r.donnees.deja ? "Ce message était déjà retiré." : "Message retiré du site.", ton: "succes" });
    await recharger();
  }
  const statut =
    etat === "en-cours"
      ? `Jusqu'à ${quand(m.fin)}`
      : etat === "a-venir"
        ? plage(m.debut, m.fin)
        : etat === "retire"
          ? `Retiré ${quand(m.retire_le!)}`
          : `Fini ${quand(m.fin)}`;
  return (
    <li className="bo-msg-ligne" data-etat={etat}>
      <p className="bo-msg-texte">{m.texte}</p>
      <p className="bo-msg-meta">
        <span className="bo-msg-etiquette">{etat === "en-cours" ? "En ligne" : etat === "a-venir" ? "À venir" : etat === "retire" ? "Retiré" : "Fini"}</span>
        <span>{OU[m.emplacement]}</span>
        <span>{statut}</span>
        <span>Par {m.cree_par}</span>
      </p>
      {(etat === "en-cours" || etat === "a-venir") && (
        <button type="button" className="bo-bouton bo-bouton-second" disabled={envoi} onClick={retirer} aria-label={`Retirer le message « ${m.texte.slice(0, 40)} »`}>
          Retirer
        </button>
      )}
    </li>
  );
}

type Valeurs = { texte: string; emplacement: "accueil" | "partout"; tout_de_suite: boolean; debut_jour: string; debut_heure: string; fin_jour: string; fin_heure: string };

function valeursDeDepart(): Valeurs {
  const ici = instantGeneve(new Date());
  // Fin proposée : ce soir 23h00, ou demain 23h00 après 22h00. Toujours à changer selon le message.
  const fin = ici.minutes >= 22 * 60 ? ajouterJours(ici.date, 1) : ici.date;
  return { texte: "", emplacement: "accueil", tout_de_suite: true, debut_jour: ici.date, debut_heure: "18:00", fin_jour: fin, fin_heure: "23:00" };
}

function bornes(v: Valeurs): { debut: Date | null; fin: Date | null } {
  return {
    debut: v.tout_de_suite ? null : depuisHeureGeneve(`${v.debut_jour}T${v.debut_heure}`),
    fin: depuisHeureGeneve(`${v.fin_jour}T${v.fin_heure}`),
  };
}

function valider(v: Valeurs): Partial<Record<keyof Valeurs, string>> {
  const e: Partial<Record<keyof Valeurs, string>> = {};
  const t = v.texte.replace(/\s+/g, " ").trim();
  if (t.length < 5 || t.length > 200) e.texte = "De 5 à 200 caractères.";
  else if (resteACompleter(t)) e.texte = MESSAGE_A_COMPLETER;
  const { debut, fin } = bornes(v);
  const maintenant = Date.now();
  if (!v.tout_de_suite && (!debut || debut.getTime() < maintenant - 60_000)) e.debut_jour = "Un début à venir, ou « Tout de suite ».";
  else if (debut && debut.getTime() > maintenant + 60 * 86_400_000) e.debut_jour = "Dans les 60 jours au plus.";
  const depart = debut?.getTime() ?? maintenant;
  if (!fin || fin.getTime() <= depart) e.fin_jour = "Une fin après le début.";
  else if (fin.getTime() - depart > 60 * 86_400_000) e.fin_jour = "60 jours au plus après le début.";
  return e;
}

function Programmer({ apres }: { apres: () => Promise<void> }) {
  const notifier = useNotifier();
  const confirmer = useConfirmer();
  // Figées au montage : recalculées à chaque rendu, elles changeraient à 22h00 ou à minuit et la relecture
  // de chaque minute effacerait la saisie en cours.
  const [depart] = useState(valeursDeDepart);
  const f = useFormulaire<Valeurs>(depart, {
    valider,
    enregistrer: (v) => {
      const { debut, fin } = bornes(v);
      return poster(URL, {
        type: "ajouter",
        texte: v.texte.replace(/\s+/g, " ").trim(),
        debut: debut ? debut.toISOString() : null,
        fin: fin!.toISOString(),
        emplacement: v.emplacement,
      });
    },
    apres: () => {
      notifier({ texte: "Message programmé.", ton: "succes" });
      apres();
    },
  });
  const v = f.valeurs;
  const { debut, fin } = bornes(v);
  const resume =
    fin && Object.keys(valider(v)).filter((k) => k !== "texte").length === 0
      ? `Visible ${v.emplacement === "accueil" ? "sur l'accueil" : "sur l'accueil, la carte, le panier et le paiement"}. ${
          debut ? plage(debut.toISOString(), fin.toISOString()) : `Dès maintenant, jusqu'à ${quand(fin.toISOString())}`
        }.`
      : null;

  return (
    <form className="bo-msg-form" onSubmit={f.soumettre} noValidate>
      <fieldset className="bo-msg-modeles">
        <legend>Partir d&apos;un modèle</legend>
        <p className="aide">Le modèle remplit le champ. Complétez les passages entre crochets, puis programmez : rien ne s&apos;affiche avant.</p>
        <div className="bo-msg-modeles-liste">
          {MODELES_MESSAGES.map((m) => (
            <button
              key={m.cle}
              type="button"
              className="bo-bouton bo-bouton-second"
              onClick={async () => {
                if (v.texte.trim() && v.texte !== m.texte) {
                  const ok = await confirmer({ titre: "Remplacer le texte ?", texte: "Le texte déjà saisi sera remplacé par le modèle.", oui: "Remplacer" });
                  if (!ok) return;
                }
                f.changer("texte", m.texte);
                f.changer("emplacement", m.emplacement);
              }}
            >
              {m.titre}
            </button>
          ))}
        </div>
      </fieldset>
      <Champ
        libelle="Texte lu par les clients"
        aide="Tel quel, sans mise en forme. Faites-le valider par Jérémy avant de le programmer. Jamais un nom ni un numéro de commande."
        erreur={f.erreurs.texte}
      >
        {(a) => (
          <>
            <textarea {...a} rows={3} maxLength={200} value={v.texte} onChange={(e) => f.changer("texte", e.target.value)} />
            <p className="bo-msg-compte" aria-live="polite">
              {v.texte.length} sur 200 caractères
            </p>
          </>
        )}
      </Champ>

      <fieldset className="bo-msg-choix">
        <legend>Où</legend>
        <label>
          <input type="radio" name="emplacement" checked={v.emplacement === "accueil"} onChange={() => f.changer("emplacement", "accueil")} />
          <span>L&apos;accueil seulement</span>
        </label>
        <label>
          <input type="radio" name="emplacement" checked={v.emplacement === "partout"} onChange={() => f.changer("emplacement", "partout")} />
          <span>Tout le site : accueil, carte, panier et paiement</span>
        </label>
      </fieldset>

      <fieldset className="bo-msg-choix">
        <legend>À partir de</legend>
        <label>
          <input type="radio" name="debut" checked={v.tout_de_suite} onChange={() => f.changer("tout_de_suite", true)} />
          <span>Tout de suite</span>
        </label>
        <label>
          <input type="radio" name="debut" checked={!v.tout_de_suite} onChange={() => f.changer("tout_de_suite", false)} />
          <span>Une date et une heure</span>
        </label>
        {!v.tout_de_suite && (
          <div className="bo-msg-heure">
            <Champ libelle="Jour du début" erreur={f.erreurs.debut_jour}>
              {(a) => <input {...a} type="date" value={v.debut_jour} onChange={(e) => f.changer("debut_jour", e.target.value)} />}
            </Champ>
            <Champ libelle="Heure du début">
              {(a) => <input {...a} type="time" step={900} value={v.debut_heure} onChange={(e) => f.changer("debut_heure", e.target.value)} />}
            </Champ>
          </div>
        )}
      </fieldset>

      <fieldset className="bo-msg-choix">
        <legend>Jusqu&apos;à</legend>
        <p className="aide">Le message s&apos;arrête seul à cette heure.</p>
        <div className="bo-msg-heure">
          <Champ libelle="Jour de fin" erreur={f.erreurs.fin_jour}>
            {(a) => <input {...a} type="date" value={v.fin_jour} onChange={(e) => f.changer("fin_jour", e.target.value)} />}
          </Champ>
          <Champ libelle="Heure de fin">
            {(a) => <input {...a} type="time" step={900} value={v.fin_heure} onChange={(e) => f.changer("fin_heure", e.target.value)} />}
          </Champ>
        </div>
      </fieldset>

      {resume && (
        <p className="bo-msg-resume" role="status">
          {resume}
        </p>
      )}
      <BarreEnregistrer etat={f.etat} message={f.message} modifie={f.modifie} libelle="Programmer le message" reinitialiser={f.reinitialiser} />
    </form>
  );
}
