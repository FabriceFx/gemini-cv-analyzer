/**
 * Constants.gs
 * Regroupe les constantes et la configuration par défaut de l'application.
 */

const CONFIG_SHEET_NAME = "Configuration";
const RESULTS_SHEET_NAME = "Résultats de l'analyse";
const RGPD_LOG_SHEET_NAME = "Journal RGPD";

const DEFAULT_PROMPT = "Agis en tant que Recruteur Senior. Je te fournis l'offre d'emploi suivante :\n{{JOB_DESCRIPTION}}\n\net le CV d'un candidat. Tu ne dois rien inventer et tu ne dois faire aucune interprétation : réfère-toi uniquement aux données explicites du CV et de l'offre d'emploi.\n\nConsignes spécifiques du recruteur :\n{{CRITERIA}}\n\nConsignes de mise en forme et de logique :\nFormat du texte : N'utilise jamais de puces (points ou tirets) pour séparer les idées dans les champs texte. Privilégie des parenthèses ou du texte fluide. Pour les compétences, indique le statut général (Oui / Non / Partiel) suivi des éléments précis entre parenthèses, par exemple : 'Oui (compétence X, compétence Y)' ou 'Partiel (compétence Z)'.\n\nIntitule ton rapport : 'Analyse des CV par l'IA'.";

// Liste des modèles Gemini supportés et recommandés
const AVAILABLE_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro"
];

const MAX_EXECUTION_TIME = 5 * 60 * 1000; // 5 minutes pour éviter le timeout Google Apps Script
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB limite de Gemini API
const GEMINI_FREE_BATCH_SIZE = 3;
const GEMINI_FREE_BATCH_PAUSE_MS = 12000;
const GEMINI_PAID_BATCH_SIZE = 15;
const GEMINI_PAID_BATCH_PAUSE_MS = 6000;
