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
 * @property {string} [Domaines autorisés]
 */

const CONFIG_SHEET_NAME = "Configuration";
const RESULTS_SHEET_NAME = "Résultats de l'analyse";
const RGPD_LOG_SHEET_NAME = "Journal RGPD";

// Index des colonnes de la feuille Résultats (1-based)
const COL_INDEX = {
  CANDIDATE: 1,
  EMAIL: 2,
  PHONE: 3,
  EXPERIENCE: 4,
  EDUCATION: 5,
  SKILLS: 6,
  STRENGTHS: 7,
  WEAKNESSES: 8,
  RECOMMENDATION: 9,
  SCORE: 10,
  FILE_LINK: 11,
  DATE: 12,
  FILE_ID: 13
};

const DEFAULT_PROMPT = "Agis en tant que Recruteur Senior. Je te fournis l'offre d'emploi suivante :\n{{JOB_DESCRIPTION}}\n\net le CV d'un candidat. Tu ne dois rien inventer et tu ne dois faire aucune interprétation : réfère-toi uniquement aux données explicites du CV et de l'offre d'emploi.\n\nConsignes spécifiques du recruteur :\n{{CRITERIA}}\n\nPrincipe de non-discrimination : Fais abstraction totale de toute information relative à l'âge, au genre, à la photo, à l'adresse postale, à la nationalité ou à l'origine du candidat. Évalue uniquement les compétences, l'expérience et l'adéquation objective avec les critères du poste.\n\nConsignes de mise en forme et de logique :\nFormat du texte : N'utilise jamais de puces (points ou tirets) pour séparer les idées dans les champs texte. Privilégie des parenthèses ou du texte fluide. Pour les compétences, indique le statut général (Oui / Non / Partiel) suivi des éléments précis entre parenthèses, par exemple : 'Oui (compétence X, compétence Y)' ou 'Partiel (compétence Z)'.\nRègle d'évaluation : Sois rigoureux et sélectif. Attribue 'À contacter' uniquement aux profils présentant une très bonne adéquation (note de 4 ou 5 sur 5) et qui méritent réellement une prise de contact. Pour les profils moyens ou avec des manques partiels, attribue 'À garder en vivier' (note de 3). Pour les profils inadaptés, attribue 'À refuser' (note de 1 ou 2).\n\nIntitule ton rapport : 'Analyse des CV par l'IA'.";

// Liste des modèles Gemini supportés et recommandés
const AVAILABLE_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.7-pro",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro"
];

const MAX_CONTACT_CANDIDATES = 10; // Plafond maximal de candidats proposés en prise de contact
const MIN_CONTACT_SCORE = 4; // Note minimale (sur 5) pour une prise de contact active

// Gestion du temps et des reprises automatiques (contournement de la limite des 6 min)
const MAX_EXECUTION_TIME = 4.5 * 60 * 1000; // 4 minutes 30 secondes avant de programmer la reprise
const CONTINUATION_TRIGGER_HANDLER = "_resumeAnalysisTrigger";
const PROP_KEY_JOB_STATE = "CV_ANALYZER_JOB_STATE";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB limite de Gemini API
const GEMINI_FREE_BATCH_SIZE = 3;
const GEMINI_FREE_BATCH_PAUSE_MS = 12000;
const GEMINI_PAID_BATCH_SIZE = 15;
const GEMINI_PAID_BATCH_PAUSE_MS = 6000;

const SUPPORTED_MIME_TYPES = [
  MimeType.PDF,
  MimeType.GOOGLE_DOCS,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" // DOCX
];

const DEFAULT_ALLOWED_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "welcome-to-the-jungle.com",
  "glassdoor.com",
  "pole-emploi.fr",
  "francetravail.fr",
  "monster.fr",
  "apside.com",
  "apec.fr",
  "hellowork.com",
  "talent-soft.com"
];

// Internationalisation (I18N)
const DICTIONARY = {
  fr: {
    menuTitle: '🚀 Analyseur de CV',
    menuSidebar: '📂 Ouvrir le panneau de contrôle',
    menuInit: '⚙️ Initialiser / réinitialiser les feuilles',
    menuConfig: '🔑 Configurer la clé API',
    menuAnalyzeAll: '🔍 Analyser les nouveaux CV (dossier complet)',
    menuAnalyzeSingle: '📄 Analyser un seul CV (test rapide)',
    menuDailyTrigger: '⏰ Activer/désactiver l\'analyse quotidienne',
    menuDraftEmails: '📧 Générer les emails de réponse (brouillons)',
    menuPurge: '🛡️ Nettoyage RGPD des anciens CV',
    menuClear: '🧹 Vider les résultats',
    menuGuide: '📖 Guide & bonnes pratiques',
    menuAbout: 'ℹ️ À propos'
  },
  en: {
    menuTitle: '🚀 CV Analyzer',
    menuSidebar: '📂 Open control panel',
    menuInit: '⚙️ Initialize / reset sheets',
    menuConfig: '🔑 Configure API Key',
    menuAnalyzeAll: '🔍 Analyze new CVs (Full folder)',
    menuAnalyzeSingle: '📄 Analyze single CV (Quick test)',
    menuDailyTrigger: '⏰ Toggle daily analysis trigger',
    menuDraftEmails: '📧 Draft response emails',
    menuPurge: '🛡️ GDPR Cleanup of old CVs',
    menuClear: '🧹 Clear results',
    menuGuide: '📖 Guide & best practices',
    menuAbout: 'ℹ️ About'
  }
};

function t(key) {
  const userLocale = Session.getActiveUserLocale() || 'fr';
  const lang = userLocale.startsWith('en') ? 'en' : 'fr';
  return DICTIONARY[lang][key] || key;
}
