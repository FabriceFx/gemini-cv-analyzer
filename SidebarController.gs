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
    .setWidth(360);
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
 * Enregistre les modifications de configuration saisies dans le formulaire de la Sidebar.
 * @param {Object} formData
 * @returns {{ok: boolean, message: string}}
 */
function saveSidebarConfig(formData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) {
    setupSheets();
    configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  }

  try {
    const mapping = {
      folderUrl: "B4",
      jobDescription: "B5",
      model: "B6",
      accountType: "B7",
      criteria: "B8",
      retentionDays: "B10",
      allowedDomains: "B11"
    };

    if (formData.folderUrl !== undefined) configSheet.getRange(mapping.folderUrl).setValue(formData.folderUrl);
    if (formData.jobDescription !== undefined) configSheet.getRange(mapping.jobDescription).setValue(formData.jobDescription);
    if (formData.model !== undefined) configSheet.getRange(mapping.model).setValue(formData.model);
    if (formData.accountType !== undefined) configSheet.getRange(mapping.accountType).setValue(formData.accountType);
    if (formData.criteria !== undefined) configSheet.getRange(mapping.criteria).setValue(formData.criteria);
    if (formData.retentionDays !== undefined) configSheet.getRange(mapping.retentionDays).setValue(Number(formData.retentionDays) || 730);
    if (formData.allowedDomains !== undefined) configSheet.getRange(mapping.allowedDomains).setValue(formData.allowedDomains);

    return { ok: true, message: "Configuration enregistrée avec succès." };
  } catch (e) {
    return { ok: false, message: "Erreur lors de la sauvegarde : " + e.message };
  }
}

/**
 * Déclenche l'analyse des CVs depuis le bouton de la Sidebar.
 * @returns {{ok: boolean, message: string}}
 */
function startAnalysisFromSidebar() {
  try {
    // Initialise l'état du job
    _updateProgressState({
      status: "RUNNING",
      total: 0,
      processed: 0,
      successCount: 0,
      errorCount: 0,
      currentFileName: "Initialisation...",
      recentCandidates: [],
      lastUpdated: Date.now()
    });

    // Lancer l'analyse en mode non-interactif
    _runAnalysis({ interactive: false });
    return { ok: true, message: "Traitement lancé." };
  } catch (e) {
    _updateProgressState({
      status: "ERROR",
      errorMessage: e.message,
      lastUpdated: Date.now()
    });
    return { ok: false, message: e.message };
  }
}

/**
 * Retourne l'état d'avancement actuel pour le polling temps réel de la Sidebar.
 * @returns {Object}
 */
function getAnalysisProgress() {
  const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
  if (!rawState) {
    return { status: "IDLE", total: 0, processed: 0, successCount: 0, errorCount: 0 };
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
 * Génère un brouillon d'email Gmail pour un seul candidat spécifié.
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

  const isAccepted = candidate.recommendation === "À contacter";
  const firstName = (!candidate.name || candidate.name === "Inconnu") ? "" : (candidate.name.split(' ')[0] || candidate.name);
  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,";

  const prompt = `Agis comme un recruteur bienveillant et professionnel.
Rédige un email très court et poli à l'intention du candidat.
Contexte : Le candidat a postulé à une de nos offres.
Décision : ${isAccepted ? "Nous souhaitons le contacter pour un entretien." : "Nous ne retenons pas sa candidature pour ce poste."}
Ses points forts (à mentionner brièvement s'ils sont pertinents) : ${candidate.strengths}
Raisons du refus (si refus) ou points à creuser (si accepté) : ${candidate.weaknesses}
Rédige uniquement le corps de l'email (pas d'objet, pas de placeholders pour ma signature). Commence directement par '${greeting}'`;

  try {
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 }
    };
    const responseText = callGeminiAPI(model, payload, apiKey);
    const json = JSON.parse(responseText);
    if (json.candidates && json.candidates[0]) {
      const emailBody = json.candidates[0].content.parts[0].text;
      const subject = isAccepted ? `Suite à votre candidature - Échange téléphonique` : `Suite à votre candidature`;
      GmailApp.createDraft(candidate.email, subject, emailBody);
      return { ok: true, message: `Brouillon Gmail créé pour ${candidate.name}.` };
    }
  } catch (e) {
    return { ok: false, message: "Erreur génération email : " + e.message };
  }
  return { ok: false, message: "Impossible de générer le brouillon." };
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
