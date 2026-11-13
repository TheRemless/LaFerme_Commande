// Kit du back-office (vague 3). Mode d'emploi : docs/vague-3/kit-back-office.md.
export { CarteChiffre } from "@/components/gestion/ui/CarteChiffre";
export { BoiteConfirmation, useConfirmer, type Demande } from "@/components/gestion/ui/Confirmation";
export { celluleCsv, documentCsv, nomFichierCsv, telechargerCsv } from "@/components/gestion/ui/csv";
export { BandeauHorsLigne, Chargement, DroitsInsuffisants, EtatErreur, EtatVide } from "@/components/gestion/ui/Etats";
export { ecartPourcent, ecartTexte, montant, nombre } from "@/components/gestion/ui/format";
export { BarreEnregistrer, Champ, useFormulaire, type EtatEnvoi, type OptionsFormulaire } from "@/components/gestion/ui/Formulaire";
export { useGardeModifications, usePeutPartir } from "@/components/gestion/ui/Garde";
export { IconeGestion, type NomIconeGestion } from "@/components/gestion/ui/icones";
export { useNotifier, type Notification } from "@/components/gestion/ui/Notifications";
export { Onglets, type Onglet } from "@/components/gestion/ui/Onglets";
export { PanneauLateral } from "@/components/gestion/ui/PanneauLateral";
export { decalerJour, dureeJours, periodeComparaison, periodeDe, verifierPeriode, type Periode } from "@/components/gestion/ui/periodes";
export { Touches, useRaccourci } from "@/components/gestion/ui/Raccourcis";
export { SelecteurPeriode } from "@/components/gestion/ui/SelecteurPeriode";
export { TableauDonnees, type Colonne, type Tri } from "@/components/gestion/ui/TableauDonnees";
export { useDiffere } from "@/components/gestion/ui/useDiffere";
