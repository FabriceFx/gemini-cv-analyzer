/**
 * Constants.gs
 * Regroupe les constantes et la configuration par défaut de l'application.
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {string} candidateName - Nom du candidat
 * @property {string} email - Email du candidat
 * @property {string} phone - Téléphone du candidat
 * @property {string} experience - Expérience pertinente
 * @property {string} education - Formation et diplômes
 * @property {string} skills - Top 3 compétences
 * @property {string} strengths - Points forts
 * @property {string} weaknesses - Points faibles
 * @property {string} recommendation - Recommandation ("À contacter", "À garder en vivier", "À refuser")
 * @property {number} score - Note sur 5
 */

/**
 * @typedef {Object} Config
 * @property {string} [URL du dossier Drive contenant les CVs]
 * @property {string} [URL ou texte de l'annonce]
 * @property {string} [Modèle Gemini]
 * @property {string} [Type de compte Gemini]
 * @property {string} [Critères spécifiques du recruteur]
 * @property {string} [Prompt système]
 * @property {number} [Délai de rétention RGPD (jours)]
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

const MAX_BATCH_TOKENS = 150000; // Limite estimée pour gemini-3.5-flash
const MAX_TOTAL_TOKENS_PER_REQUEST = 200000; // Limite par requête

const SUPPORTED_MIME_TYPES = [
  MimeType.PDF,
  MimeType.GOOGLE_DOCS,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword", // DOC
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template", // DOTX
];

const ALLOWED_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "welcome-to-the-jungle.com",
  "glassdoor.com",
  "pôle-emploi.fr",
  "francetravail.fr",
  "monster.fr",
  "apside.com",
  "apec.fr",
  "hellowork.com"
];
