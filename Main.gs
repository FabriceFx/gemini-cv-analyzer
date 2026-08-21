/**
 * Main.gs
 * Point d'entrée principal pour l'orchestration de l'analyse (batch, unitaire, et reprise automatique).
 */

function analyzeCVs() {
  return _runAnalysis({ interactive: true, source: 'interactive' });
}

function analyzeCVsAutomated() {
  return _runAnalysis({ interactive: false, source: 'automated' });
}

/**
 * Handler appelé par le déclencheur de reprise automatique (contournement de la limite des 6 min).
 */
function _resumeAnalysisTrigger() {
  _cleanupContinuationTriggers();
  _runAnalysis({ interactive: false, isContinuation: true, source: 'sidebar' });
}

function _notifyAutomatedFailure(reason) {
  const userEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
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
 * Gère le découpage en sous-lots, les pauses de quota et la reprise automatique anti-timeout.
 */
function _runAnalysis(options) {
  const isInteractive = options && options.interactive;
  const isContinuation = options && options.isContinuation;
  const source = (options && options.source) || (isInteractive ? 'interactive' : 'automated');
  const lock = LockService.getScriptLock();
  
  if (!lock.tryLock(5000)) {
    if (source === 'interactive') {
      SpreadsheetApp.getActiveSpreadsheet().toast("Une analyse est déjà en cours, veuillez patienter.", "⏳");
    } else if (source === 'sidebar') {
      _updateProgressState({ status: "BUSY", errorMessage: "Une analyse est déjà en cours d'exécution." });
    }
    return;
  }

  // Activer le trigger chien de garde de secours à +7 minutes (au cas où le script serait tué brutalement)
  _scheduleWatchdogTrigger();

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

    if (!configSheet || !resultsSheet) {
      const errMsg = "Les feuilles Configuration et Résultats sont introuvables.";
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser les feuilles via le menu '⚙️ Initialiser / Réinitialiser les feuilles'.");
      } else if (source === 'automated') {
        _notifyAutomatedFailure(errMsg);
      }
      _updateProgressState({ status: "ERROR", errorMessage: errMsg });
      _cleanupContinuationTriggers();
      return;
    }

    const startTime = Date.now();

    let commonConfig;
    try {
      commonConfig = _prepareCommonConfig(configSheet, isInteractive);
    } catch (e) {
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert(`Configuration requise : ${e.message}`);
      } else if (source === 'automated') {
        _notifyAutomatedFailure(`Configuration incomplète : ${e.message}`);
      }
      _updateProgressState({ status: "ERROR", errorMessage: e.message });
      _cleanupContinuationTriggers();
      return;
    }
    const { apiKey, jobDescription, model, criteria, systemPrompt, config } = commonConfig;

    const folderUrl = (config['URL du dossier Drive contenant les CVs'] || '').toString().trim();
    if (!folderUrl) {
      const errMsg = "L'URL du dossier Drive configurée est manquante.";
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert("Erreur de configuration : l'URL du dossier Drive est manquante.");
      } else if (source === 'automated') {
        _notifyAutomatedFailure(errMsg);
      }
      _updateProgressState({ status: "ERROR", errorMessage: errMsg });
      _cleanupContinuationTriggers();
      return;
    }

    const accountType = (config['Type de compte Gemini'] || '').toString().trim();
    const isPaidAccount = accountType === "Payant (Pay-as-you-go)";
    const batchSize = isPaidAccount ? GEMINI_PAID_BATCH_SIZE : GEMINI_FREE_BATCH_SIZE;
    const batchPauseMs = isPaidAccount ? GEMINI_PAID_BATCH_PAUSE_MS : GEMINI_FREE_BATCH_PAUSE_MS;

    const folderId = getFolderIdFromUrl(folderUrl);
    if (!folderId) {
      const errMsg = "L'URL du dossier Drive configurée est invalide.";
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert("Erreur de configuration : l'URL du dossier Drive semble invalide.");
      } else if (source === 'automated') {
        _notifyAutomatedFailure(errMsg);
      }
      _updateProgressState({ status: "ERROR", errorMessage: errMsg });
      _cleanupContinuationTriggers();
      return;
    }

    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      const errMsg = `Impossible d'accéder au dossier Drive : ${e.message}`;
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert(`Erreur d'accès Drive : ${e.message}`);
      } else if (source === 'automated') {
        _notifyAutomatedFailure(errMsg);
      }
      _updateProgressState({ status: "ERROR", errorMessage: errMsg });
      _cleanupContinuationTriggers();
      return;
    }

    const processedIds = {};
    const lastRow = resultsSheet.getLastRow();
    if (lastRow > 3) {
      const existingData = resultsSheet.getRange(4, 1, lastRow - 3, 13).getValues();
      for (let i = 0; i < existingData.length; i++) {
        const row = existingData[i];
        const reco = (row[COL_INDEX.RECOMMENDATION - 1] || '').toString().trim();
        const id = (row[COL_INDEX.FILE_ID - 1] || '').toString().trim();
        // Ne considérer comme déjà traité que si l'analyse a réussi (pas en statut Erreur)
        if (id && reco !== "Erreur") {
          processedIds[id] = true;
        }
      }
    }

    const files = folder.getFiles();
    const filesToProcess = [];
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      if (fileName.startsWith("tmp_")) continue;
      const mime = file.getMimeType();
      if (SUPPORTED_MIME_TYPES.includes(mime) && !processedIds[file.getId()]) {
        filesToProcess.push(file);
      }
    }

    const alreadyProcessedCount = Object.keys(processedIds).length;
    const totalFilesCount = filesToProcess.length + alreadyProcessedCount;

    if (filesToProcess.length === 0) {
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert("Aucun nouveau document à analyser. (PDF, Google Doc ou DOCX)");
      }
      _updateProgressState({
        status: "COMPLETED",
        total: totalFilesCount,
        processed: totalFilesCount,
        currentFileName: "Tous les documents sont à jour"
      });
      _cleanupContinuationTriggers();
      return;
    }

    // Confirmation uniquement en interactif classique
    if (source === 'interactive' && !isContinuation) {
      const ui = SpreadsheetApp.getUi();
      const costResponse = ui.alert(
        "Confirmation",
        `Vous êtes sur le point d'analyser ${filesToProcess.length} nouveau${filesToProcess.length > 1 ? 'x' : ''} document${filesToProcess.length > 1 ? 's' : ''} avec le modèle ${model}.\nVoulez-vous lancer le traitement ?`,
        ui.ButtonSet.YES_NO
      );
      if (costResponse !== ui.Button.YES) {
        _cleanupContinuationTriggers();
        return;
      }
      ss.toast(`Début de l'analyse : ${filesToProcess.length} document${filesToProcess.length > 1 ? 's' : ''} détecté${filesToProcess.length > 1 ? 's' : ''}.`, "Lancement 🚀");
    }

    // Nettoyage des anciennes lignes Erreur pour les fichiers qui vont être réanalysés
    _removeOrphanErrorRows(resultsSheet, filesToProcess.map(f => f.getId()));

    // Mise à jour de l'état initial dans PropertiesService
    _updateProgressState({
      status: "RUNNING",
      total: totalFilesCount,
      processed: alreadyProcessedCount,
      successCount: 0,
      errorCount: 0,
      currentFileName: "Démarrage des lots d'analyse..."
    });

    // Tentative de Context Caching si lot important
    let cacheName = null;
    if (filesToProcess.length >= 5) {
      if (source === 'interactive') ss.toast("Vérification du cache de contexte...", "Cache 🧠");
      cacheName = createGeminiCache(apiKey, model, systemPrompt, jobDescription, criteria);
    }

    let successCount = 0;
    let errorCount = 0;
    let stoppedByTimeout = false;
    let maxBatchDuration = 0;
    const allRecentCandidates = [];

    for (let batchStart = 0; batchStart < filesToProcess.length; batchStart += batchSize) {
      const elapsed = Date.now() - startTime;
      
      // Contrôle de temps proactif AVANT d'engager le lot (si temps écoulé + max batch + 30s > 4m30)
      if (batchStart > 0 && elapsed + maxBatchDuration + 30000 > MAX_EXECUTION_TIME) {
        const remaining = filesToProcess.length - batchStart;
        if (remaining > 0) {
          _scheduleContinuationTrigger();
          _updateProgressState({
            status: "CONTINUING",
            currentFileName: "Reprise automatique programmée dans 1 min..."
          });
          if (source === 'interactive') {
            ss.toast("Temps limite approché. Reprise automatique à +1 min.", "Reprise ⏳", 8);
          }
          stoppedByTimeout = true;
          break;
        }
      }

      const batch = filesToProcess.slice(batchStart, batchStart + batchSize);
      if (source === 'interactive') {
        ss.toast(`Traitement du lot ${Math.floor(batchStart / batchSize) + 1} (${batch.length} document${batch.length > 1 ? 's' : ''})...`, "Analyse 🔍");
      }

      _updateProgressState({
        status: "RUNNING",
        total: totalFilesCount,
        processed: alreadyProcessedCount + successCount + errorCount,
        currentFileName: batch[0].getName()
      });

      const batchStartTime = Date.now();
      const batchResults = analyzeDocumentsBatch(batch, apiKey, model, jobDescription, criteria, systemPrompt, cacheName);
      const batchDuration = Date.now() - batchStartTime;
      if (batchDuration > maxBatchDuration) {
        maxBatchDuration = batchDuration;
      }

      const rowsToAdd = [];
      const richTextLinks = [];
      const errorRowIndices = [];

      batchResults.forEach(result => {
        if (result.analysis) {
          rowsToAdd.push([
            result.analysis.candidateName || "Inconnu",
            result.analysis.email || "Non renseigné",
            result.analysis.phone || "Non renseigné",
            result.analysis.experience || "",
            result.analysis.education || "",
            result.analysis.skills || "",
            result.analysis.strengths || "",
            result.analysis.weaknesses || "",
            result.analysis.recommendation || "À garder en vivier",
            result.analysis.score || 1,
            result.file.getName(),
            new Date(),
            result.file.getId()
          ]);
          richTextLinks.push({ name: result.file.getName(), url: result.file.getUrl() });
          allRecentCandidates.push({
            name: result.analysis.candidateName || "Inconnu",
            score: result.analysis.score || 1,
            reco: result.analysis.recommendation || "À garder en vivier"
          });
          successCount++;
        } else {
          Logger.log(`Erreur CV (${result.file.getName()}) : ${result.error}`);
          rowsToAdd.push([
            "Erreur d'analyse",
            "",
            "",
            "",
            "",
            "",
            `Une erreur s'est produite : ${result.error}`,
            "",
            "Erreur",
            0,
            result.file.getName(),
            new Date(),
            result.file.getId()
          ]);
          richTextLinks.push({ name: result.file.getName(), url: result.file.getUrl() });
          allRecentCandidates.push({
            name: result.file.getName(),
            score: 0,
            reco: "Erreur"
          });
          errorRowIndices.push(rowsToAdd.length - 1);
          errorCount++;
        }
      });

      if (rowsToAdd.length > 0) {
        _appendBatchResults(resultsSheet, rowsToAdd, richTextLinks, errorRowIndices);
      }

      // Mise à jour de la progression en direct
      _updateProgressState({
        status: "RUNNING",
        total: totalFilesCount,
        processed: alreadyProcessedCount + successCount + errorCount,
        successCount: successCount,
        errorCount: errorCount,
        recentCandidates: allRecentCandidates.slice(-6),
        currentFileName: batch[batch.length - 1].getName()
      });

      // Pause entre lots pour respecter le quota RPM (si temps restant suffisant)
      if (batchStart + batchSize < filesToProcess.length) {
        if (Date.now() - startTime + batchPauseMs + 30000 > MAX_EXECUTION_TIME) {
          _scheduleContinuationTrigger();
          _updateProgressState({
            status: "CONTINUING",
            currentFileName: "Reprise automatique au prochain lot (+1 min)..."
          });
          stoppedByTimeout = true;
          break;
        }
        Utilities.sleep(batchPauseMs);
      }
    }

    // Nettoyage explicite du cache Gemini (plutôt que d'attendre son TTL)
    deleteGeminiCache(cacheName, apiKey);

    // Si le traitement s'est terminé complètement (non interrompu par le timeout)
    if (!stoppedByTimeout) {
      _cleanupContinuationTriggers();

      // Tri par note décroissante
      let topContactCount = 0;
      const finalLastRow = resultsSheet.getLastRow();
      if (finalLastRow > 3) {
        resultsSheet.getRange(4, 1, finalLastRow - 3, 13).sort({ column: COL_INDEX.SCORE, ascending: false });
        topContactCount = _optimizeContactRecommendations(resultsSheet);
      }

      // Synthèse globale
      if (resultsSheet.getLastRow() > 3) {
        const candidatesData = resultsSheet.getRange(4, 1, resultsSheet.getLastRow() - 3, 10).getValues();
        const summaryList = candidatesData
          .filter(c => c[COL_INDEX.RECOMMENDATION - 1] !== "Erreur")
          .map(c => `- ${c[0]} : Note ${c[COL_INDEX.SCORE - 1]}/5, Reco: ${c[COL_INDEX.RECOMMENDATION - 1]}`);
        
        if (summaryList.length > 0) {
          try {
            if (source === 'interactive') ss.toast("Génération de la synthèse...", "Synthèse 🧠", 10);
            const sessionSynthesis = generateSessionSynthesis(summaryList.join("\n"), jobDescription, apiKey, model);
            resultsSheet.getRange("A2").setValue(`Synthèse globale : ${sessionSynthesis}`);
          } catch (synthErr) {
            resultsSheet.getRange("A2").setValue("Synthèse globale : Analyse terminée.");
          }
        }
      }

      _updateProgressState({
        status: "COMPLETED",
        total: totalFilesCount,
        processed: totalFilesCount,
        successCount: successCount,
        errorCount: errorCount,
        topContactCount: topContactCount,
        currentFileName: "Terminé avec succès",
        recentCandidates: allRecentCandidates.slice(-6)
      });

      let endMessage = `Analyse terminée pour ${successCount} document${successCount > 1 ? 's' : ''}.`;
      if (successCount > 0) {
        endMessage += `\n🎯 ${topContactCount} profil${topContactCount > 1 ? 's retenus' : ' retenu'} pour la prise de contact (Top ${MAX_CONTACT_CANDIDATES} max qualifiés).`;
      }
      if (errorCount > 0) endMessage += `\n⚠️ ${errorCount} fichier(s) en erreur (pourront être réanalysés).`;
      
      if (source === 'interactive') {
        SpreadsheetApp.getUi().alert(`Bilan : ${endMessage}`);
      } else if (source === 'automated') {
        const userEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
        if (userEmail) {
          MailApp.sendEmail({
            to: userEmail,
            subject: "🤖 Analyse de CV terminée avec succès",
            body: `Bonjour,\n\nVotre analyse de CV automatique vient de se terminer.\n\n${endMessage}\n\nConsultez votre fichier Google Sheets pour découvrir les résultats.\n\nL'équipe AI.`
          });
        }
      }
    }

  } catch (err) {
    Logger.log("Erreur globale _runAnalysis : " + err.message);
    _updateProgressState({
      status: "ERROR",
      errorMessage: err.message
    });
    if (source === 'automated') {
      _notifyAutomatedFailure(err.message);
    } else if (source === 'interactive') {
      SpreadsheetApp.getUi().alert(`Erreur : ${err.message}`);
    }
    _cleanupContinuationTriggers();
    throw err;
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
    if (!SUPPORTED_MIME_TYPES.includes(mime)) {
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

      const row = [
        analysis.candidateName || "Inconnu",
        analysis.email || "Non renseigné",
        analysis.phone || "Non renseigné",
        analysis.experience || "",
        analysis.education || "",
        analysis.skills || "",
        analysis.strengths || "",
        analysis.weaknesses || "",
        analysis.recommendation || "À garder en vivier",
        analysis.score || 1,
        file.getName(),
        new Date(),
        file.getId()
      ];
      _removeOrphanErrorRows(resultsSheet, [fileId]);
      _appendBatchResults(resultsSheet, [row], [{ name: file.getName(), url: file.getUrl() }], []);

      ui.alert(`Analyse réussie pour : ${analysis.candidateName}\nRecommandation: ${analysis.recommendation}\nNote: ${analysis.score}/5`);
    } catch (err) {
      ui.alert("Erreur lors de l'analyse : " + err.message);
      const errorRow = [
        "Erreur d'analyse", "", "", "", "", "", `Une erreur s'est produite : ${err.message}`, "", "Erreur", 0, file.getName(), new Date(), file.getId()
      ];
      _removeOrphanErrorRows(resultsSheet, [fileId]);
      _appendBatchResults(resultsSheet, [errorRow], [{ name: file.getName(), url: file.getUrl() }], [0]);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Active ou désactive un déclencheur quotidien pour l'analyse en arrière-plan (fixé à 02h00).
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
  ScriptApp.newTrigger('analyzeCVsAutomated').timeBased().everyDays(1).atHour(2).create();
  SpreadsheetApp.getActiveSpreadsheet().toast("Analyse automatique activée (quotidienne à 02h00).", "On ⏰");
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
    _updateProgressState({ status: "IDLE", total: 0, processed: 0, currentFileName: "" });
    ss.toast("Le tableau des résultats a été réinitialisé.", "Vidé 🧹");
  }
}

/**
 * Supprime les anciennes lignes en statut 'Erreur' pour les fichiers qui vont être réanalysés.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} resultsSheet
 * @param {string[]} fileIdsToProcess
 */
function _removeOrphanErrorRows(resultsSheet, fileIdsToProcess) {
  const lastRow = resultsSheet.getLastRow();
  if (lastRow < 4 || !fileIdsToProcess || fileIdsToProcess.length === 0) return;
  
  const numRows = lastRow - 3;
  const data = resultsSheet.getRange(4, 1, numRows, 13).getValues();
  const fileIdSet = {};
  fileIdsToProcess.forEach(id => { fileIdSet[id] = true; });

  for (let i = numRows - 1; i >= 0; i--) {
    const reco = (data[i][COL_INDEX.RECOMMENDATION - 1] || '').toString().trim();
    const id = (data[i][COL_INDEX.FILE_ID - 1] || '').toString().trim();
    if (reco === "Erreur" && fileIdSet[id]) {
      resultsSheet.deleteRow(4 + i);
    }
  }
}

/**
 * Écrit un lot de résultats dans la feuille et applique le formatage en une seule opération groupée.
 */
function _appendBatchResults(resultsSheet, rows, richTextLinks, errorIndices) {
  const startRow = resultsSheet.getLastRow() + 1;
  const numRows = rows.length;
  
  // 1. Appliquer le format texte sur la colonne téléphone AVANT d'insérer les valeurs
  resultsSheet.getRange(startRow, COL_INDEX.PHONE, numRows, 1).setNumberFormat("@");

  // 2. Écrire les données du lot
  const range = resultsSheet.getRange(startRow, 1, numRows, 13);
  range.setValues(rows);
  range.setVerticalAlignment("top").setWrap(true).setFontFamily("Inter");

  // 3. Formatage des liens RichText pour les fichiers
  const richTextValues = richTextLinks.map(link => [
    SpreadsheetApp.newRichTextValue().setText(link.name).setLinkUrl(link.url).build()
  ]);
  resultsSheet.getRange(startRow, COL_INDEX.FILE_LINK, numRows, 1)
    .setRichTextValues(richTextValues)
    .setHorizontalAlignment("center")
    .setFontColor("#64748b");

  resultsSheet.getRange(startRow, COL_INDEX.RECOMMENDATION, numRows, 1).setHorizontalAlignment("center").setFontWeight("bold");
  resultsSheet.getRange(startRow, COL_INDEX.SCORE, numRows, 1).setHorizontalAlignment("center").setFontWeight("bold").setNumberFormat("0");
  resultsSheet.getRange(startRow, COL_INDEX.DATE, numRows, 1).setHorizontalAlignment("center").setNumberFormat("dd/MM/yyyy HH:mm");

  if (errorIndices && errorIndices.length > 0) {
    errorIndices.forEach(idx => {
      resultsSheet.getRange(startRow + idx, 1, 1, 13).setFontColor("#dc2626");
    });
  }

  // 4. Forcer la synchronisation avec la feuille
  SpreadsheetApp.flush();
}

/**
 * Harmonise les recommandations de prise de contact après analyse et tri.
 * N'écrit QUE sur la colonne Recommandation (col 9) pour préserver strictement les liens et les formats de téléphones.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} resultsSheet
 * @returns {number} Nombre de candidats retenus en prise de contact
 */
function _optimizeContactRecommendations(resultsSheet) {
  const lastRow = resultsSheet.getLastRow();
  if (lastRow < 4) return 0;

  const numRows = lastRow - 3;
  const data = resultsSheet.getRange(4, COL_INDEX.RECOMMENDATION, numRows, 2).getValues();
  
  const candidateObjects = data.map(row => ({
    recommendation: row[0],
    score: row[1]
  }));

  const newRecos = computeContactRecommendations(candidateObjects, MAX_CONTACT_CANDIDATES, MIN_CONTACT_SCORE);

  let hasChanges = false;
  let contactCount = 0;
  const recoColumnData = [];

  for (let i = 0; i < numRows; i++) {
    const updatedReco = newRecos[i];
    if (updatedReco === "À contacter") {
      contactCount++;
    }
    if (updatedReco !== data[i][0]) {
      hasChanges = true;
    }
    recoColumnData.push([updatedReco]);
  }

  if (hasChanges) {
    resultsSheet.getRange(4, COL_INDEX.RECOMMENDATION, numRows, 1).setValues(recoColumnData);
  }

  return contactCount;
}

/**
 * Met à jour l'état du traitement dans PropertiesService via la fonction pure mergeJobState.
 * @param {Object} stateUpdates
 */
function _updateProgressState(stateUpdates) {
  try {
    const props = PropertiesService.getScriptProperties();
    const existingRaw = props.getProperty(PROP_KEY_JOB_STATE);
    let currentState = {};
    if (existingRaw) {
      try { currentState = JSON.parse(existingRaw); } catch (e) { }
    }
    const newState = mergeJobState(currentState, stateUpdates);
    props.setProperty(PROP_KEY_JOB_STATE, JSON.stringify(newState));
  } catch (e) {
    Logger.log("Erreur mise à jour état progression : " + e.message);
  }
}

/**
 * Supprime les éventuels déclencheurs temporaires de reprise orphelins.
 */
function _cleanupContinuationTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === CONTINUATION_TRIGGER_HANDLER) {
        ScriptApp.deleteTrigger(trigger);
      }
    }
  } catch (e) {
    Logger.log("Erreur nettoyage déclencheurs de reprise : " + e.message);
  }
}

/**
 * Programme une reprise automatique proactive à +1 minute lorsque le temps limite approche.
 */
function _scheduleContinuationTrigger() {
  _cleanupContinuationTriggers();
  ScriptApp.newTrigger(CONTINUATION_TRIGGER_HANDLER)
    .timeBased()
    .after(60 * 1000)
    .create();
  Logger.log("Déclencheur de reprise automatique programmé dans 1 minute.");
}

/**
 * Active un déclencheur chien de garde (watchdog) à +7 minutes au cas où le script serait tué brutalement par GAS.
 */
function _scheduleWatchdogTrigger() {
  _cleanupContinuationTriggers();
  ScriptApp.newTrigger(CONTINUATION_TRIGGER_HANDLER)
    .timeBased()
    .after(7 * 60 * 1000)
    .create();
}

/**
 * Prépare la configuration et valide les paramètres communs.
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
