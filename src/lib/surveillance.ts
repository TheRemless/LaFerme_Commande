import "server-only";
import { chargerConfigService } from "@/lib/config-service";
import { envoyerParResend, resendConfigure } from "@/lib/courriel/envoi";
import { enregistrerCourriel, fonctionSql } from "@/lib/db/serveur";
import { etatService } from "@/lib/service";
import { rafraichirCaches } from "@/lib/tablette";

// Surveillance du service, une fois par minute au plus, déclenchée par les passages des imprimantes,
// les relectures de la tablette et, en production, une fonction planifiée Netlify.
// 1. Une commande du jour attend d'être acceptée depuis plus que le délai réglé : alerte au restaurant.
// 2. La tablette ne donne plus signe de vie pendant le service : pause des commandes en ligne et alerte.

const TABLETTE_MUETTE_S = 180;

// Courriel au restaurant (ALERTE_EMAIL). Sans Resend, gardé en base comme les autres courriels de test.
export async function alerter(sujet: string, lignes: string[]): Promise<void> {
  const texte = [...lignes, "", "Site de commande La Ferme"].join("\n");
  const html = `<pre>${texte.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`;
  const destinataire = process.env.ALERTE_EMAIL;
  if (resendConfigure() && destinataire) {
    await envoyerParResend(destinataire, sujet, texte, html, `alerte-${sujet}-${new Date().toISOString().slice(0, 16)}`);
  } else {
    console.error(`Alerte (aucun courriel configuré) : ${sujet}`);
  }
  await enregistrerCourriel({
    commande_id: null,
    destinataire: destinataire ?? "restaurant",
    sujet,
    texte,
    html,
    fournisseur: resendConfigure() && destinataire ? "resend" : "doublure",
  });
}

export async function executerSurveillance(maintenant = new Date()): Promise<{ fait: boolean; retards: number; pause: boolean }> {
  if (!(await fonctionSql<boolean>("tour_de_surveillance", {}))) return { fait: false, retards: 0, pause: false };

  const retards = await fonctionSql<{ numero: number; cree_le: string }[]>("commandes_en_retard", {});
  if (retards.length) {
    const numeros = retards.map((r) => r.numero).join(", ");
    await alerter(retards.length > 1 ? `Commandes ${numeros} pas encore acceptées` : `Commande ${numeros} pas encore acceptée`, [
      `${retards.length > 1 ? "Les commandes" : "La commande"} ${numeros} ${retards.length > 1 ? "attendent" : "attend"} sur la tablette.`,
      "Le client n'a pas encore d'heure confirmée.",
    ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
  }

  let pause = false;
  if (await fonctionSql<boolean>("tablette_muette", { p_secondes: TABLETTE_MUETTE_S })) {
    const config = await chargerConfigService();
    // Seulement pendant le service : hors service, la tablette éteinte est normale.
    if (etatService(config, maintenant, "retrait").etat === "ouvert" && (await fonctionSql<boolean>("pause_automatique", {}))) {
      pause = true;
      rafraichirCaches("config-service");
      await alerter("Tablette injoignable : commandes en ligne en pause", [
        "La tablette ne répond plus depuis plus de 3 minutes.",
        "Les commandes en ligne sont en pause. Rallumez la tablette, puis touchez « Reprendre les commandes ».",
      ]).catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
    }
  }
  return { fait: true, retards: retards.length, pause };
}
