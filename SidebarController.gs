/**
 * SidebarController.gs
 * Contrôleur serveur pour le panneau latéral (Sidebar) HtmlService.
 * Fait le pont entre l'interface utilisateur MD3 et les services d'analyse/stockage.
 */

/**
 * Affiche le panneau latéral dans Google Sheets.
 */
function showSidebar() {
  const htmlOutput = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle("🚀 Analyseur de CV AI")
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/**
 * Récupère l'état initial complet nécessaire au chargement de la Sidebar.
 * @returns {Object}
 */
function getSidebarInitialData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  const isApiKeySet = apiKey.length > 0;

  let config = {};
  if (configSheet) {
    try {
      config = getConfig(configSheet);
    } catch (e) {
      Logger.log("Erreur lecture config: " + e.message);
    }
  }

  // État actuel du job de traitement
  let jobState = { status: "IDLE", total: 0, processed: 0, successCount: 0, errorCount: 0 };
  const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
  if (rawState) {
    try {
      jobState = JSON.parse(rawState);
    } catch (e) { }
  }

  // Liste des candidats récents pour le sélecteur
  const candidatesList = [];
  let selectedCandidate = null;

  if (resultsSheet) {
    const lastRow = resultsSheet.getLastRow();
    if (lastRow > 3) {
      const numRows = lastRow - 3;
      const data = resultsSheet.getRange(4, 1, numRows, 13).getValues();
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const name = (row[COL_INDEX.CANDIDATE - 1] || '').toString().trim();
        const reco = (row[COL_INDEX.RECOMMENDATION - 1] || '').toString().trim();
        const score = Number(row[COL_INDEX.SCORE - 1]) || 0;
        const fileId = (row[COL_INDEX.FILE_ID - 1] || '').toString().trim();
        if (name) {
          candidatesList.push({
            rowNumber: 4 + i,
            name: name,
            recommendation: reco,
            score: score,
            fileId: fileId
          });
        }
      }

      // Détecter si la cellule active est sur une ligne de candidat
      const activeRange = resultsSheet.getActiveRange();
      if (activeRange) {
        const activeRow = activeRange.getRow();
        if (activeRow >= 4 && activeRow <= lastRow) {
          selectedCandidate = _buildCandidateObjectFromRow(resultsSheet, activeRow);
        }
      }

      // Si aucun candidat n'est actif, prendre le premier par défaut
      if (!selectedCandidate && candidatesList.length > 0) {
        selectedCandidate = _buildCandidateObjectFromRow(resultsSheet, candidatesList[0].rowNumber);
      }
    }
  }

  return {
    isApiKeySet: isApiKeySet,
    config: {
      folderUrl: config['URL du dossier Drive contenant les CVs'] || '',
      jobDescription: config["URL ou texte de l'annonce"] || '',
      model: config['Modèle Gemini'] || 'gemini-3.7-flash',
      accountType: config['Type de compte Gemini'] || 'Gratuit (Free tier)',
      criteria: config['Critères spécifiques du recruteur'] || '',
      retentionDays: config['Délai de rétention RGPD (jours)'] || 730,
      allowedDomains: config['Domaines autorisés'] || DEFAULT_ALLOWED_DOMAINS.join(", ")
    },
    availableModels: AVAILABLE_MODELS,
    jobState: jobState,
    candidatesList: candidatesList,
    selectedCandidate: selectedCandidate
  };
}

/**
 * Enregistre les modifications de configuration saisies dans le formulaire de la Sidebar en écrivant par libellé en colonne A.
 * @param {Object} formData
 * @returns {{ok: boolean, message: string}}
 */
function saveSidebarConfig(formData) {
  if (!formData || typeof formData !== 'object') {
    return { ok: false, message: "Données de formulaire invalides." };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) {
    setupSheets();
    configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  }

  try {
    const data = configSheet.getRange("A:B").getValues();
    const mapping = {
      "URL du dossier Drive contenant les CVs": formData.folderUrl,
      "URL ou texte de l'annonce": formData.jobDescription,
      "Modèle Gemini": formData.model,
      "Type de compte Gemini": formData.accountType,
      "Critères spécifiques du recruteur": formData.criteria,
      "Délai de rétention RGPD (jours)": formData.retentionDays !== undefined ? Number(formData.retentionDays) : undefined,
      "Domaines autorisés": formData.allowedDomains
    };

    for (let i = 0; i < data.length; i++) {
      const label = (data[i][0] || '').toString().trim();
      if (mapping[label] !== undefined && mapping[label] !== null) {
        configSheet.getRange(i + 1, 2).setValue(mapping[label]);
      }
    }

    return { ok: true, message: "Configuration enregistrée avec succès." };
  } catch (e) {
    return { ok: false, message: "Erreur lors de la sauvegarde : " + e.message };
  }
}

/**
 * Déclenche l'analyse des CVs de façon asynchrone non-bloquante depuis la Sidebar.
 * @param {Object} formData
 * @returns {{ok: boolean, message: string}}
 */
function startAnalysisFromSidebar(formData) {
  try {
    // 1. Sauvegarder d'abord la configuration soumise par l'utilisateur
    if (formData) {
      const saveRes = saveSidebarConfig(formData);
      if (!saveRes.ok) return saveRes;
    }

    // 2. Vérifier la clé API
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { ok: false, message: "Clé API non configurée. Utilisez le menu pour configurer votre clé." };
    }

    // 3. Initialiser l'état du job
    _updateProgressState({
      status: "RUNNING",
      total: 0,
      processed: 0,
      successCount: 0,
      errorCount: 0,
      currentFileName: "Démarrage du traitement en arrière-plan...",
      recentCandidates: []
    });

    // 4. Lancement asynchrone via déclencheur à +1 seconde (libère immédiatement le client)
    _scheduleImmediateAnalysisTrigger();

    return { ok: true, message: "Analyse démarrée avec succès." };
  } catch (e) {
    _updateProgressState({
      status: "ERROR",
      errorMessage: e.message
    });
    return { ok: false, message: e.message };
  }
}

/**
 * Programme un déclencheur d'exécution quasi-immédiat (+1 seconde).
 * @private
 */
function _scheduleImmediateAnalysisTrigger() {
  _cleanupContinuationTriggers();
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
    return { status: "IDLE", total: 0, processed: 0, successCount: 0, errorCount: 0, lastUpdated: Date.now() };
  }
  try {
    return JSON.parse(rawState);
  } catch (e) {
    return { status: "ERROR", errorMessage: "Erreur lecture état", lastUpdated: Date.now() };
  }
}

/**
 * Récupère la fiche détaillée d'un candidat par son numéro de ligne dans la feuille Résultats.
 * @param {number} rowNumber
 * @returns {Object|null}
 */
function getCandidateDetailsByRow(rowNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!resultsSheet || rowNumber < 4) return null;
  return _buildCandidateObjectFromRow(resultsSheet, rowNumber);
}

/**
 * Récupère le candidat correspondant à la sélection active dans la feuille.
 * @returns {Object|null}
 */
function getSelectedCandidateDetails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!resultsSheet) return null;

  const activeRange = resultsSheet.getActiveRange();
  if (!activeRange) return null;

  const activeRow = activeRange.getRow();
  if (activeRow < 4 || activeRow > resultsSheet.getLastRow()) return null;

  return _buildCandidateObjectFromRow(resultsSheet, activeRow);
}

/**
 * Génère un brouillon d'email Gmail pour un seul candidat spécifié en utilisant la logique partagée d'EmailService.
 * @param {number} rowNumber
 * @returns {{ok: boolean, message: string}}
 */
function draftSingleCandidateEmail(rowNumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!resultsSheet || !configSheet) return { ok: false, message: "Feuilles introuvables." };

  const candidate = _buildCandidateObjectFromRow(resultsSheet, rowNumber);
  if (!candidate || !candidate.email || !isValidEmail(candidate.email)) {
    return { ok: false, message: "Email du candidat manquant ou invalide." };
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const config = getConfig(configSheet);
  const model = (config['Modèle Gemini'] || 'gemini-3.7-flash').toString().trim();

  if (!apiKey) return { ok: false, message: "Clé API non configurée." };

  return _createCandidateDraft(candidate, apiKey, model);
}

/**
 * Construit un objet structuré représentant un candidat à partir de sa ligne.
 * @private
 */
function _buildCandidateObjectFromRow(resultsSheet, rowNumber) {
  const row = resultsSheet.getRange(rowNumber, 1, 1, 13).getValues()[0];
  const richText = resultsSheet.getRange(rowNumber, COL_INDEX.FILE_LINK).getRichTextValue();
  const fileUrl = richText ? richText.getLinkUrl() : "";

  return {
    rowNumber: rowNumber,
    name: (row[COL_INDEX.CANDIDATE - 1] || 'Inconnu').toString().trim(),
    email: (row[COL_INDEX.EMAIL - 1] || '').toString().trim(),
    phone: (row[COL_INDEX.PHONE - 1] || '').toString().trim(),
    experience: (row[COL_INDEX.EXPERIENCE - 1] || '').toString().trim(),
    education: (row[COL_INDEX.EDUCATION - 1] || '').toString().trim(),
    skills: (row[COL_INDEX.SKILLS - 1] || '').toString().trim(),
    strengths: (row[COL_INDEX.STRENGTHS - 1] || '').toString().trim(),
    weaknesses: (row[COL_INDEX.WEAKNESSES - 1] || '').toString().trim(),
    recommendation: (row[COL_INDEX.RECOMMENDATION - 1] || 'À garder en vivier').toString().trim(),
    score: Number(row[COL_INDEX.SCORE - 1]) || 0,
    fileName: (row[COL_INDEX.FILE_LINK - 1] || '').toString().trim(),
    fileUrl: fileUrl,
    fileId: (row[COL_INDEX.FILE_ID - 1] || '').toString().trim()
  };
}
