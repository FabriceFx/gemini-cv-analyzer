/**
 * Main.gs
 * Point d'entrée principal pour l'orchestration de l'analyse (batch et unitaire).
 */

function analyzeCVs() {
  return _runAnalysis({ interactive: true });
}

function analyzeCVsAutomated() {
  return _runAnalysis({ interactive: false });
}

function _notifyAutomatedFailure(reason) {
  const userEmail = Session.getActiveUser().getEmail();
  if (userEmail) {
    MailApp.sendEmail({
      to: userEmail,
      subject: "⚠️ Échec de l'analyse de CV automatique",
      body: `L'analyse automatique n'a pas pu démarrer :\n\n${reason}\n\nVeuillez vérifier la configuration de votre outil.`
    });
  }
}

/**
 * Fonction principale : Liste les fichiers du dossier, les analyse et les note par rapport à l'offre d'emploi.
 */
function _runAnalysis(options) {
  const isInteractive = options && options.interactive;
  const lock = LockService.getScriptLock();
  
  if (!lock.tryLock(5000)) {
    if (isInteractive) SpreadsheetApp.getActiveSpreadsheet().toast("Une analyse est déjà en cours, veuillez patienter.", "⏳");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

    if (!configSheet || !resultsSheet) {
      if (isInteractive) {
        SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser les feuilles via le menu '\u2699\ufe0f Initialiser / Réinitialiser les feuilles'.");
      } else {
        _notifyAutomatedFailure("Les feuilles Configuration et Résultats sont introuvables.");
      }
      return;
    }

    const startTime = Date.now();

    let commonConfig;
    try {
      commonConfig = _prepareCommonConfig(configSheet, isInteractive);
    } catch (e) {
      if (isInteractive) {
        SpreadsheetApp.getUi().alert(`Configuration requise : ${e.message}`);
      } else {
        _notifyAutomatedFailure(`Configuration incomplète : ${e.message}`);
      }
      return;
    }
    const { apiKey, jobDescription, model, criteria, systemPrompt, config } = commonConfig;

    const folderUrl = (config['URL du dossier Drive contenant les CVs'] || '').toString().trim();
    if (!folderUrl) {
      if (isInteractive) {
        SpreadsheetApp.getUi().alert("Erreur de configuration : l'URL du dossier Drive est manquante.");
      } else {
        _notifyAutomatedFailure("L'URL du dossier Drive configurée est manquante.");
      }
      return;
    }

    const accountType = (config['Type de compte Gemini'] || '').toString().trim();
    const isPaidAccount = accountType === "Payant (Pay-as-you-go)";
    const batchSize = isPaidAccount ? GEMINI_PAID_BATCH_SIZE : GEMINI_FREE_BATCH_SIZE;
    const batchPauseMs = isPaidAccount ? GEMINI_PAID_BATCH_PAUSE_MS : GEMINI_FREE_BATCH_PAUSE_MS;

    const folderId = getFolderIdFromUrl(folderUrl);
    if (!folderId) {
      if (isInteractive) {
        SpreadsheetApp.getUi().alert("Erreur de configuration : l'URL du dossier Drive semble invalide.");
      } else {
        _notifyAutomatedFailure("L'URL du dossier Drive configurée est invalide.");
      }
      return;
    }

    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      if (isInteractive) {
        SpreadsheetApp.getUi().alert(`Erreur d'accès Drive : impossible d'accéder au dossier. Détail : ${e.message}`);
      } else {
        _notifyAutomatedFailure(`Impossible d'accéder au dossier Drive : ${e.message}`);
      }
      return;
    }

    const processedIds = {};
    const lastRow = resultsSheet.getLastRow();
    if (lastRow > 3) {
      const existingIds = resultsSheet.getRange(4, 13, lastRow - 3, 1).getValues();
      for (let i = 0; i < existingIds.length; i++) {
        const id = existingIds[i][0].toString().trim();
        if (id) processedIds[id] = true;
      }
    }

    const files = folder.getFiles();
    const filesToProcess = [];
    while (files.hasNext()) {
      const file = files.next();
      const mime = file.getMimeType();
      if (SUPPORTED_MIME_TYPES.includes(mime) && !processedIds[file.getId()]) {
        filesToProcess.push(file);
      }
    }

    if (filesToProcess.length === 0) {
      if (isInteractive) SpreadsheetApp.getUi().alert("Aucun nouveau document à analyser. (PDF ou DOCX)");
      return;
    }

    // Estimation des coûts et confirmation
    if (isInteractive) {
      const ui = SpreadsheetApp.getUi();
      const costResponse = ui.alert(
        "Confirmation",
        `Vous êtes sur le point d'analyser ${filesToProcess.length} nouveau${filesToProcess.length > 1 ? 'x' : ''} document${filesToProcess.length > 1 ? 's' : ''} avec le modèle ${model}.\nVoulez-vous lancer le traitement ?`,
        ui.ButtonSet.YES_NO
      );
      if (costResponse !== ui.Button.YES) return;
      ss.toast(`Début de l'analyse : ${filesToProcess.length} document${filesToProcess.length > 1 ? 's' : ''} détecté${filesToProcess.length > 1 ? 's' : ''}.`, "Lancement 🚀");
    }

    // Tentative de Context Caching si lot important
    let cacheName = null;
    if (filesToProcess.length >= 3) {
      if (isInteractive) ss.toast("Préparation du cache pour accélérer l'analyse...", "Cache 🧠");
      cacheName = createGeminiCache(apiKey, model, systemPrompt, jobDescription, criteria);
    }

    let successCount = 0;
    let errorCount = 0;
    let stoppedByTimeout = false;

    for (let batchStart = 0; batchStart < filesToProcess.length; batchStart += batchSize) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        if (isInteractive) ss.toast("Temps d'exécution maximal approché. Mise en pause.", "Sécurité ⏳", 5);
        stoppedByTimeout = true;
        break;
      }

      const batch = filesToProcess.slice(batchStart, batchStart + batchSize);
      if (isInteractive) {
        ss.toast(`Traitement du lot ${Math.floor(batchStart / batchSize) + 1} (${batch.length} document${batch.length > 1 ? 's' : ''})...`, "Analyse 🔍");
      }

      const batchResults = analyzeDocumentsBatch(batch, apiKey, model, jobDescription, criteria, systemPrompt, cacheName);

      batchResults.forEach(result => {
        if (result.analysis) {
          _appendAnalysisResult(resultsSheet, result.analysis, result.file);
          successCount++;
        } else {
          Logger.log(`Erreur CV (${result.file.getName()}) : ${result.error}`);
          _appendErrorResult(resultsSheet, result.file, result.error);
          errorCount++;
        }
      });

      // Pause entre lots pour respecter le quota RPM (sauf après le tout dernier lot)
      if (batchStart + batchSize < filesToProcess.length) {
        Utilities.sleep(batchPauseMs);
      }
    }

    // Nettoyage explicite du cache Gemini (plutôt que d'attendre son TTL)
    deleteGeminiCache(cacheName, apiKey);

    // Tri par note décroissante
    let topContactCount = 0;
    const finalLastRow = resultsSheet.getLastRow();
    if (finalLastRow > 3) {
      resultsSheet.getRange(4, 1, finalLastRow - 3, 13).sort({ column: 10, ascending: false });
      topContactCount = _optimizeContactRecommendations(resultsSheet);
    }

    // Synthèse globale
    if (resultsSheet.getLastRow() > 3) {
      const candidatesData = resultsSheet.getRange(4, 1, resultsSheet.getLastRow() - 3, 10).getValues();
      const summaryList = candidatesData.map(c => `- ${c[0]} : Note ${c[9]}/5, Reco: ${c[8]}`);
      try {
        if (isInteractive) ss.toast("Génération de la synthèse...", "Synthèse 🧠", 10);
        const sessionSynthesis = generateSessionSynthesis(summaryList.join("\n"), jobDescription, apiKey, model);
        resultsSheet.getRange("A2").setValue(`Synthèse globale : ${sessionSynthesis}`);
      } catch (synthErr) {
        resultsSheet.getRange("A2").setValue("Synthèse globale : Analyse terminée.");
      }
    }

    let endMessage = `Analyse terminée pour ${successCount} document${successCount > 1 ? 's' : ''}.`;
    if (successCount > 0) {
      endMessage += `\n🎯 ${topContactCount} profil${topContactCount > 1 ? 's retenus' : ' retenu'} pour la prise de contact (Top ${MAX_CONTACT_CANDIDATES} max qualifiés).`;
    }
    if (errorCount > 0) endMessage += `\n⚠️ ${errorCount} fichier(s) en erreur.`;
    if (stoppedByTimeout) endMessage += "\n\n⚠️ L'analyse a été mise en pause. Relancez pour la suite.";
    
    if (isInteractive) {
      SpreadsheetApp.getUi().alert(`Bilan : ${endMessage}`);
    } else {
      const userEmail = Session.getActiveUser().getEmail();
      if (userEmail) {
        MailApp.sendEmail({
          to: userEmail,
          subject: "🤖 Analyse de CV automatique terminée",
          body: `Bonjour,\n\nVotre analyse de CV automatique vient de se terminer avec succès.\n\n${endMessage}\n\nConsultez votre fichier Google Sheets pour découvrir les résultats.\n\nL'équipe AI.`
        });
      }
    }

  } finally {
    lock.releaseLock();
  }
}

/**
 * Fonction pour analyser un seul CV via son lien (Test rapide).
 */
function analyzeSingleCV() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    SpreadsheetApp.getActiveSpreadsheet().toast("Une analyse est déjà en cours.", "⏳");
    return;
  }

  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.prompt("Analyser un seul CV", "Collez le lien Google Drive du document (PDF, Google Doc ou DOCX) :", ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;
    
    const fileUrl = response.getResponseText().trim();
    const match = fileUrl.match(/d\/([a-zA-Z0-9-_]+)/) || fileUrl.match(/id=([a-zA-Z0-9-_]+)/);
    if (!match) {
      ui.alert("URL invalide. Assurez-vous qu'elle contient l'ID du document.");
      return;
    }
    const fileId = match[1];

    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (e) {
      ui.alert("Impossible d'accéder à ce fichier. Vérifiez vos droits de lecture.");
      return;
    }
    
    const mime = file.getMimeType();
    if (mime !== MimeType.PDF && mime !== MimeType.GOOGLE_DOCS && mime !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      ui.alert(`Format non supporté (${mime}). Veuillez fournir un fichier au format PDF, DOCX ou un Google Doc.`);
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

    if (!configSheet || !resultsSheet) {
      ui.alert("Veuillez initialiser les feuilles."); return;
    }

    let commonConfig;
    try {
      commonConfig = _prepareCommonConfig(configSheet, true);
    } catch (e) {
      ui.alert(`Configuration incomplète : ${e.message}`);
      return;
    }
    const { apiKey, jobDescription, model, criteria, systemPrompt } = commonConfig;

    ss.toast("Analyse du document en cours...", "Analyse 🔍");
    try {
      const analysis = analyzeSingleDocument(file, apiKey, model, jobDescription, criteria, systemPrompt, null);
      if (analysis.recommendation === "À contacter" && analysis.score < MIN_CONTACT_SCORE) {
        analysis.recommendation = analysis.score <= 2 ? "À refuser" : "À garder en vivier";
      }
      _appendAnalysisResult(resultsSheet, analysis, file);
      ui.alert(`Analyse réussie pour : ${analysis.candidateName}\nRecommandation: ${analysis.recommendation}\nNote: ${analysis.score}/5`);
    } catch (err) {
      ui.alert("Erreur lors de l'analyse : " + err.message);
      _appendErrorResult(resultsSheet, file, err.message);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Active ou désactive un déclencheur quotidien pour l'analyse en arrière-plan.
 */
function toggleDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'analyzeCVsAutomated') {
      ScriptApp.deleteTrigger(trigger);
      SpreadsheetApp.getActiveSpreadsheet().toast("Analyse automatique désactivée.", "Off 🚫");
      return;
    }
  }
  ScriptApp.newTrigger('analyzeCVsAutomated').timeBased().everyDays(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast("Analyse automatique activée (quotidienne).", "On ⏰");
}

function clearResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!sheet) return;

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert("Confirmation", "Voulez-vous vraiment vider tout le tableau des résultats d'analyse ?", ui.ButtonSet.YES_NO);

  if (response === ui.Button.YES) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 3) {
      sheet.deleteRows(4, lastRow - 3);
    }
    sheet.getRange("A2").setValue("Synthèse globale : En attente du lancement de l'analyse pour générer les conseils de session...");
    ss.toast("Le tableau des résultats a été réinitialisé.", "Vidé 🧹");
  }
}

// Helpers internes
function _appendAnalysisResult(resultsSheet, analysis, file) {
  const fileName = file.getName();
  const newRow = [
    analysis.candidateName || "Inconnu", analysis.email || "Non renseigné",
    analysis.phone ? "'" + analysis.phone : "Non renseigné",
    analysis.experience || "", analysis.education || "", analysis.skills || "",
    analysis.strengths || "", analysis.weaknesses || "",
    analysis.recommendation || "À garder en vivier", analysis.score || 1,
    fileName, new Date(), file.getId()
  ];
  resultsSheet.appendRow(newRow);
  _formatAddedRow(resultsSheet, file);
}

function _appendErrorResult(resultsSheet, file, errorMsg) {
  const fileName = file.getName();
  const errorRow = [
    "Erreur analyse", "", "", "", "", "", `Une erreur s'est produite : ${errorMsg}`, "", "À refuser", 1, fileName, new Date(), file.getId()
  ];
  resultsSheet.appendRow(errorRow);
  _formatAddedRow(resultsSheet, file, true);
}

function _formatAddedRow(resultsSheet, file, isError = false) {
  const addedIndex = resultsSheet.getLastRow();
  const richTextLink = SpreadsheetApp.newRichTextValue().setText(file.getName()).setLinkUrl(file.getUrl()).build();
  
  resultsSheet.getRange(addedIndex, 1, 1, 13).setVerticalAlignment("top").setWrap(true).setFontFamily("Inter");
  if (isError) resultsSheet.getRange(addedIndex, 1, 1, 13).setFontColor("#dc2626");
  
  resultsSheet.getRange(addedIndex, 9).setHorizontalAlignment("center").setFontWeight("bold");
  resultsSheet.getRange(addedIndex, 10).setHorizontalAlignment("center").setFontWeight("bold").setNumberFormat("0");
  resultsSheet.getRange(addedIndex, 11).setHorizontalAlignment("center").setRichTextValue(richTextLink);
  resultsSheet.getRange(addedIndex, 12).setHorizontalAlignment("center").setNumberFormat("dd/MM/yyyy HH:mm");
  SpreadsheetApp.flush();
}

/**
 * Harmonise les recommandations de prise de contact après analyse et tri.
 * Ne retient en statut "À contacter" que les profils qualifiés (note >= MIN_CONTACT_SCORE),
 * et limite ce statut aux MAX_CONTACT_CANDIDATES (10) meilleurs CVs maximum.
 * S'il y a moins de 10 candidats qualifiés, seuls ceux-ci restent "À contacter".
 * Les candidats au-delà du 10e sont basculés en "À garder en vivier".
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} resultsSheet
 * @returns {number} Nombre de candidats retenus en prise de contact
 */
function _optimizeContactRecommendations(resultsSheet) {
  const lastRow = resultsSheet.getLastRow();
  if (lastRow < 4) return 0;

  const range = resultsSheet.getRange(4, 1, lastRow - 3, 13);
  const data = range.getValues();
  let contactCount = 0;
  let hasChanges = false;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const reco = (row[8] || '').toString().trim(); // Colonne 9 (I) : Recommandation
    const score = Number(row[9]) || 0;            // Colonne 10 (J) : Note / 5

    // Profil éligible à la prise de contact : note suffisante (>= MIN_CONTACT_SCORE) et pas explicitement à refuser
    const isQualifying = (reco === "À contacter" || score >= MIN_CONTACT_SCORE) && reco !== "À refuser" && score >= 3;

    if (isQualifying && score >= MIN_CONTACT_SCORE) {
      if (contactCount < MAX_CONTACT_CANDIDATES) {
        if (row[8] !== "À contacter") {
          row[8] = "À contacter";
          hasChanges = true;
        }
        contactCount++;
      } else {
        // Au-delà du top 10 : bascule en vivier pour ne pas saturer la prise de contact
        if (row[8] === "À contacter") {
          row[8] = "À garder en vivier";
          hasChanges = true;
        }
      }
    } else if (reco === "À contacter" && score < MIN_CONTACT_SCORE) {
      // Si la note est insuffisante pour une prise de contact active (< 4), basculer en vivier ou refuser
      row[8] = score <= 2 ? "À refuser" : "À garder en vivier";
      hasChanges = true;
    }
  }

  if (hasChanges) {
    range.setValues(data);
  }

  return contactCount;
}

/**
 * Prépare la configuration et valide les paramètres communs à analyzeCVs et analyzeSingleCV.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} configSheet
 * @param {boolean} isInteractive
 * @returns {{apiKey: string, jobDescription: string, model: string, criteria: string, systemPrompt: string, config: Object}}
 */
function _prepareCommonConfig(configSheet, isInteractive) {
  const config = getConfig(configSheet);
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const annonceInput = (config["URL ou texte de l'annonce"] || '').toString().trim();
  const model = (config['Modèle Gemini'] || 'gemini-3.7-flash').toString().trim();
  const criteria = (config['Critères spécifiques du recruteur'] || '').toString().trim();
  const rawSystemPrompt = (config['Prompt système'] || '').toString().trim();

  if (!apiKey) {
    throw new Error("Clé API manquante.");
  }
  if (!annonceInput) {
    throw new Error("URL ou texte de l'annonce manquant.");
  }

  let jobDescription = annonceInput;
  if (annonceInput.startsWith("http://") || annonceInput.startsWith("https://")) {
    if (isInteractive) SpreadsheetApp.getActiveSpreadsheet().toast("Chargement de l'annonce...", "Annonce 📄");
    const allowedDomainsStr = (config['Domaines autorisés'] || DEFAULT_ALLOWED_DOMAINS.join(", ")).toString().trim();
    jobDescription = extractJobDescriptionWithGemini(fetchJobDescription(annonceInput, allowedDomainsStr), apiKey, model);
  }

  let systemPrompt = DEFAULT_PROMPT;
  if (rawSystemPrompt.includes('{{JOB_DESCRIPTION}}') && rawSystemPrompt.includes('{{CRITERIA}}')) {
    systemPrompt = rawSystemPrompt;
  } else if (rawSystemPrompt !== "") {
    if (isInteractive) SpreadsheetApp.getActiveSpreadsheet().toast("Prompt personnalisé invalide. Utilisation du prompt par défaut.", "⚠️ Attention");
  }

  return { apiKey, jobDescription, model, criteria, systemPrompt, config };
}
