import { NextResponse } from "next/server";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import { etatImpression } from "@/lib/impression/service";
import { exigerPersonnel } from "@/lib/personnel/session";
import { etatService } from "@/lib/service";
import { surveillanceAuPassage } from "@/lib/surveillance";
import { fileTablette } from "@/lib/tablette";
import { allegerFile, versionFile } from "@/lib/tablette-file";

// Signe de vie de la tablette : la surveillance met le site en pause s'il manque 3 minutes pendant le
// service. Une écriture toutes les 30 secondes au plus par instance de fonction suffit largement.
// Seul un appareil qui a démarré le service (?service=1) le donne : un téléphone qui regarde /tablette
// ne doit pas masquer une tablette de cuisine éteinte (SS-10).
let dernierSigne = 0;
async function signeDeVie(): Promise<void> {
  const t = Date.now();
  if (t - dernierSigne < 30_000) return;
  dernierSigne = t;
  await fonctionSql("signe_tablette", {});
}

// Rythme de relecture proposé à la tablette (docs/impression.md, « Coût en requêtes ») : 15 secondes
// pendant le service ou tant qu'une commande est en cours, 60 secondes sinon. Le signal Realtime
// prévient de toute nouvelle commande sans attendre.
const RELECTURE_SERVICE_S = 15;
const RELECTURE_VEILLE_S = 60;
const ACTIVES = new Set(["nouvelle", "acceptee", "en_preparation", "prete", "partie"]);

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  const enServiceIci = new URL(requete.url).searchParams.get("service") === "1";
  await Promise.all([enServiceIci ? signeDeVie() : undefined, surveillanceAuPassage()]);
  const [commandes, config, impression] = await Promise.all([fileTablette(), chargerConfigService(), etatImpression()]);
  const maintenant = new Date();
  const etat = etatService(config, maintenant, "retrait").etat;
  const enService = etat === "ouvert" || etat === "pause" || commandes.some((c) => ACTIVES.has(c.statut));
  // File allégée (vague 3) : terminées sans leurs lignes, tâches des commandes actives seulement.
  const legere = allegerFile(commandes, impression);
  const corps = {
    commandes: legere.commandes,
    reglages: {
      pause: config.pause ?? null,
      preparation_minutes: config.reglages.preparation_minutes,
      retard_minutes: config.reglages.retard_minutes ?? 0,
      impression_avance: config.reglages.impression_avance,
    },
    impression: legere.impression,
    // Tableau par urgence (vague 3) : préparation habituelle et trajet de chaque zone (délai de la zone moins la
    // préparation, le retard du soir et l'allongement s'ajoutant aux deux), pour savoir quand lancer.
    rythme: {
      preparation: config.reglages.preparation_base ?? config.reglages.preparation_minutes,
      trajets: Object.fromEntries(config.zones.map((z) => [z.numero, Math.max(0, z.delai_min - config.reglages.preparation_minutes)])),
    },
    relecture_s: enService ? RELECTURE_SERVICE_S : RELECTURE_VEILLE_S,
  };
  // Rien de changé depuis la version que la tablette a déjà : 204 sans corps, l'heure du serveur dans un en-tête.
  // Le signe de vie et la surveillance sont déjà passés plus haut : une tablette calme reste « vivante ».
  const version = versionFile(corps);
  const entetes = { "Cache-Control": "no-store", "X-Version-File": version, "X-Maintenant": maintenant.toISOString() };
  if (new URL(requete.url).searchParams.get("version") === version) return new Response(null, { status: 204, headers: entetes });
  return NextResponse.json({ maintenant: maintenant.toISOString(), ...corps }, { headers: entetes });
}
