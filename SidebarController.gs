/**
 * SidebarController.gs
 * Contrôleur serveur pour le panneau latéral (Sidebar) HtmlService.
 *
 * Toutes les fonctions appelées par `google.script.run` sont des `function`
 * déclarées dont le nom ne finit pas par « _ » : Google rend inappelables
 * depuis le navigateur les fonctions privées, sans autre signe qu'un
 * `undefined` côté client.
 *
 * Les candidats sont désignés par l'**identifiant de leur fichier**, jamais
 * par un numéro de ligne : une analyse peut trier l'onglet pendant que le
 * panneau est ouvert, et un brouillon partirait vers le mauvais candidat.
 *
 * Les lectures du panneau ne mettent pas l'onglet à niveau : elles ne prennent
 * pas le verrou, et deux ajouts de colonnes simultanés doubleraient les
 * en-têtes. Une colonne absente se lit simplement vide.
 */

/**
 * Affiche le panneau latéral dans Google Sheets.
 */
function showSidebar() {
  const htmlOutput = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('🚀 Analyseur de CV AI')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/** Candidats de l'onglet, pour le sélecteur du panneau. */
const listeCandidats_ = (feuille, carte) => lireLignesResultats_(feuille, carte)
  .map((ligne) => ({
    fileId: texteLigne_(ligne, COLONNES_RESULTATS.ID),
    name: texteLigne_(ligne, COLONNES_RESULTATS.CANDIDAT),
    recommendation: texteLigne_(ligne, COLONNES_RESULTATS.RECOMMANDATION),
    score: valeurLigne_(ligne, COLONNES_RESULTATS.SCORE),
  }))
  .filter((c) => c.fileId && c.name);

/** Fiche du candidat sur la ligne active de l'onglet Résultats, ou `null`. */
const candidatDeLaLigneActive_ = (feuille, carte) => {
  if (SpreadsheetApp.getActiveSheet().getName() !== RESULTS_SHEET_NAME) return null;
  const active = feuille.getActiveRange();
  if (!active) return null;
  const numero = active.getRow();
  if (numero < PREMIERE_LIGNE_RESULTATS || numero > feuille.getLastRow()) return null;
  const ligne = lireLignesResultats_(feuille, carte).find((l) => l.numero === numero);
  return ligne ? ficheCandidatDepuisLigne_(ligne) : null;
};

/**
 * Récupère l'état initial complet nécessaire au chargement de la Sidebar.
 * @returns {Object}
 */
function getSidebarInitialData() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  const config = getConfig();

  let jobState = { status: 'IDLE', total: 0, processed: 0, successCount: 0, errorCount: 0 };
  const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
  if (rawState) {
    try {
      jobState = JSON.parse(rawState);
    } catch (e) { }
  }

  let candidatesList = [];
  let selectedCandidate = null;
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET_NAME);
  if (feuille) {
    try {
      const carte = lireEnteteResultats_(feuille).carte;
      candidatesList = listeCandidats_(feuille, carte);
      selectedCandidate = candidatDeLaLigneActive_(feuille, carte);
      if (!selectedCandidate && candidatesList.length > 0) {
        selectedCandidate = getCandidateDetails(candidatesList[0].fileId);
      }
    } catch (e) {
      Logger.log(`Lecture des candidats impossible : ${e.message}`);
    }
  }

  return {
    version: ANALYSEUR_CV_VERSION,
    isApiKeySet: apiKey.length > 0,
    config: {
      folderUrl: config.folderUrl,
      jobDescription: config.jobDescription,
      model: config.model,
      accountType: config.accountType,
      criteria: config.criteria,
      // Vide = prompt par défaut. Le défaut n'est plus affiché dans le champ :
      // il y était, et partait dans les réglages au premier enregistrement.
      systemPrompt: config.systemPrompt,
      retentionDays: config.retentionDays,
      allowedDomains: config.allowedDomains,
      seuilContact: config.seuilContact,
      seuilVivier: config.seuilVivier,
      placesContact: config.placesContact,
    },
    grille: resumeGrille_(),
    availableModels: AVAILABLE_MODELS,
    jobState,
    candidatesList,
    selectedCandidate,
  };
}

/**
 * Enregistre les modifications de configuration saisies dans le formulaire de la Sidebar directement dans DocumentProperties.
 * @param {Object} formData
 * @returns {{ok: boolean, message: string}}
 */
function saveSidebarConfig(formData) {
  if (!formData || typeof formData !== 'object') {
    return { ok: false, message: 'Données de formulaire invalides.' };
  }
  return saveConfig(formData);
}

/**
 * Déclenche l'analyse des CVs de façon asynchrone non-bloquante depuis la Sidebar.
 * @param {Object} formData
 * @returns {{ok: boolean, message: string}}
 */
function startAnalysisFromSidebar(formData) {
  try {
    // 1. Vérifier si une analyse n'est pas déjà en cours avant toute opération
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) {
      return { ok: false, message: "Une analyse est déjà en cours d'exécution. Veuillez patienter." };
    }
    lock.releaseLock();

    // Vérifier également si l'état stocké indique un traitement actif récent (anti-double clic)
    const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
    if (rawState) {
      try {
        const parsed = JSON.parse(rawState);
        const elapsed = Date.now() - (parsed.lastUpdated || 0);
        const isRunning = (parsed.status === 'RUNNING' || parsed.status === 'CONTINUING') && elapsed < 15 * 60 * 1000;
        const isScheduled = parsed.status === 'SCHEDULED' && elapsed < 3 * 60 * 1000;
        if (isRunning || isScheduled) {
          return { ok: false, message: "Une analyse est déjà en cours d'exécution. Veuillez patienter." };
        }
      } catch (e) { }
    }

    // 2. Sauvegarder d'abord la configuration soumise par l'utilisateur
    if (formData) {
      const saveRes = saveSidebarConfig(formData);
      if (!saveRes.ok) return saveRes;
    }

    // 3. Vérifier la clé API et la grille maintenant, plutôt que dans un déclencheur que personne ne regarde
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { ok: false, message: 'Clé API non configurée. Utilisez le menu pour configurer votre clé.' };
    }
    referentielCourant_();

    // 4. Initialiser l'état du job en statut SCHEDULED
    _updateProgressState({
      status: 'SCHEDULED',
      source: 'sidebar',
      total: 0,
      processed: 0,
      successCount: 0,
      errorCount: 0,
      errorMessage: '',
      waitingSince: 0,
      currentFileName: 'Démarrage programmé : c\'est Google qui lance l\'analyse, après un délai de quelques secondes à quelques minutes.',
      recentCandidates: [],
    });

    // 5. Lancement asynchrone via déclencheur à +1 seconde (libère immédiatement le client)
    _scheduleImmediateAnalysisTrigger();

    return { ok: true, message: 'Analyse programmée avec succès.' };
  } catch (e) {
    _updateProgressState({
      status: 'ERROR',
      errorMessage: e.message,
    });
    return { ok: false, message: e.message };
  }
}

/**
 * Réinitialise manuellement l'état du traitement à IDLE sans impacter les données du classeur.
 * @returns {{ok: boolean, message: string}}
 */
function resetJobProgressState() {
  try {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(0)) {
      return { ok: false, message: "Une analyse est réellement en cours d'exécution. Le déblocage n'est pas nécessaire." };
    }
    lock.releaseLock();

    _cleanupContinuationTriggers();
    _updateProgressState({
      status: 'IDLE',
      source: 'sidebar',
      total: 0,
      processed: 0,
      successCount: 0,
      errorCount: 0,
      topContactCount: 0,
      errorMessage: '',
      currentFileName: '',
      recentCandidates: [],
    });
    return { ok: true, message: 'État réinitialisé avec succès.' };
  } catch (e) {
    return { ok: false, message: `Erreur réinitialisation : ${e.message}` };
  }
}

/**
 * Programme un déclencheur d'exécution quasi-immédiat (+1 seconde) sans écraser d'autres handlers.
 * @private
 */
function _scheduleImmediateAnalysisTrigger() {
  ScriptApp.newTrigger(CONTINUATION_TRIGGER_HANDLER)
    .timeBased()
    .after(1000)
    .create();
}

/**
 * Retourne l'état d'avancement actuel pour le polling temps réel de la Sidebar.
 * @returns {Object}
 */
function getAnalysisProgress() {
  const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
  if (!rawState) {
    return { status: 'IDLE', total: 0, processed: 0, successCount: 0, errorCount: 0, lastUpdated: Date.now() };
  }
  try {
    return JSON.parse(rawState);
  } catch (e) {
    return { status: 'ERROR', errorMessage: 'Erreur lecture état', lastUpdated: Date.now() };
  }
}

/**
 * Fiche détaillée d'un candidat, désigné par l'identifiant de son fichier.
 * @param {string} fileId
 * @returns {Object|null}
 */
function getCandidateDetails(fileId) {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET_NAME);
  if (!feuille || !fileId) return null;
  const carte = lireEnteteResultats_(feuille).carte;
  const ligne = lireLignesResultats_(feuille, carte).find((l) => texteLigne_(l, COLONNES_RESULTATS.ID) === fileId);
  return ligne ? ficheCandidatDepuisLigne_(ligne) : null;
}

/**
 * Récupère le candidat correspondant à la sélection active dans la feuille.
 * @returns {Object|null}
 */
function getSelectedCandidateDetails() {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET_NAME);
  if (!feuille) return null;
  return candidatDeLaLigneActive_(feuille, lireEnteteResultats_(feuille).carte);
}

/**
 * Génère un brouillon d'email Gmail pour un seul candidat, désigné par son fichier.
 *
 * La décision RH prime ; à défaut, la recommandation. Un brouillon déjà daté
 * n'est pas refait : effacer la date dans « Brouillon créé le » pour en
 * obtenir un nouveau est un geste explicite, un double clic ne l'est pas.
 * @param {string} fileId
 * @returns {{ok: boolean, message: string}}
 */
function draftSingleCandidateEmail(fileId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, message: 'Une analyse est en cours ; réessayez à sa fin.' };
  }
  try {
    const { feuille, carte } = ongletResultats_();
    const ligne = lireLignesResultats_(feuille, carte).find((l) => texteLigne_(l, COLONNES_RESULTATS.ID) === fileId);
    if (!ligne) return { ok: false, message: 'Candidat introuvable : rechargez la liste du panneau.' };

    const deja = texteLigne_(ligne, COLONNES_RESULTATS.BROUILLON);
    if (deja !== '') {
      return { ok: false, message: `Un brouillon a déjà été créé pour ce candidat. Pour en obtenir un nouveau, effacez la date de la colonne « ${COLONNES_RESULTATS.BROUILLON} ».` };
    }
    const email = cleEmail_(texteLigne_(ligne, COLONNES_RESULTATS.EMAIL));
    if (!email) return { ok: false, message: 'Email du candidat manquant ou invalide.' };

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { ok: false, message: 'Clé API non configurée.' };

    const { decision } = decisionEffective_(ligne);
    const resultat = _createCandidateDraft({
      name: texteLigne_(ligne, COLONNES_RESULTATS.CANDIDAT),
      email,
      recommendation: decision,
      strengths: texteLigne_(ligne, COLONNES_RESULTATS.POINTS_FORTS),
      weaknesses: texteLigne_(ligne, COLONNES_RESULTATS.VIGILANCE),
    }, apiKey, getConfig().model);
    if (resultat.ok) marquerBrouillon_(feuille, carte, fileId);
    return resultat;
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}
