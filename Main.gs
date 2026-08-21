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
        SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser les feuilles via le menu '⚙️ Initialiser / Réinitialiser les feuilles'.");
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
      const mime = file.getMimeType();
      if (SUPPORTED_MIME_TYPES.includes(mime) && !processedIds[file.getId()]) {
        filesToProcess.push(file);
      }
    }

    if (filesToProcess.length === 0) {
      if (isInteractive) SpreadsheetApp.getUi().alert("Aucun nouveau document à analyser. (PDF, Google Doc ou DOCX)");
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
    if (filesToProcess.length >= 5) {
      if (isInteractive) ss.toast("Vérification du cache de contexte...", "Cache 🧠");
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
          errorRowIndices.push(rowsToAdd.length - 1);
          errorCount++;
        }
      });

      if (rowsToAdd.length > 0) {
        _appendBatchResults(resultsSheet, rowsToAdd, richTextLinks, errorRowIndices);
      }

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
          if (isInteractive) ss.toast("Génération de la synthèse...", "Synthèse 🧠", 10);
          const sessionSynthesis = generateSessionSynthesis(summaryList.join("\n"), jobDescription, apiKey, model);
          resultsSheet.getRange("A2").setValue(`Synthèse globale : ${sessionSynthesis}`);
        } catch (synthErr) {
          resultsSheet.getRange("A2").setValue("Synthèse globale : Analyse terminée.");
        }
      }
    }

    let endMessage = `Analyse terminée pour ${successCount} document${successCount > 1 ? 's' : ''}.`;
    if (successCount > 0) {
      endMessage += `\n🎯 ${topContactCount} profil${topContactCount > 1 ? 's retenus' : ' retenu'} pour la prise de contact (Top ${MAX_CONTACT_CANDIDATES} max qualifiés).`;
    }
    if (errorCount > 0) endMessage += `\n⚠️ ${errorCount} fichier(s) en erreur (pourront être réanalysés).`;
    if (stoppedByTimeout) endMessage += "\n\n⚠️ L'analyse a été mise en pause en raison du temps limite. Relancez pour poursuivre.";
    
    if (isInteractive) {
      SpreadsheetApp.getUi().alert(`Bilan : ${endMessage}`);
    } else {
      const userEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
      if (userEmail) {
        MailApp.sendEmail({
          to: userEmail,
          subject: "🤖 Analyse de CV automatique terminée",
          body: `Bonjour,\n\nVotre analyse de CV automatique vient de se terminer.\n\n${endMessage}\n\nConsultez votre fichier Google Sheets pour découvrir les résultats.\n\nL'équipe AI.`
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
      _appendBatchResults(resultsSheet, [row], [{ name: file.getName(), url: file.getUrl() }], []);

      ui.alert(`Analyse réussie pour : ${analysis.candidateName}\nRecommandation: ${analysis.recommendation}\nNote: ${analysis.score}/5`);
    } catch (err) {
      ui.alert("Erreur lors de l'analyse : " + err.message);
      const errorRow = [
        "Erreur d'analyse", "", "", "", "", "", `Une erreur s'est produite : ${err.message}`, "", "Erreur", 0, file.getName(), new Date(), file.getId()
      ];
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
    ss.toast("Le tableau des résultats a été réinitialisé.", "Vidé 🧹");
  }
}

/**
 * Écrit un lot de résultats dans la feuille et applique le formatage en une seule opération groupée.
 */
function _appendBatchResults(resultsSheet, rows, richTextLinks, errorIndices) {
  const startRow = resultsSheet.getLastRow() + 1;
  const numRows = rows.length;
  
  const range = resultsSheet.getRange(startRow, 1, numRows, 13);
  range.setValues(rows);
  range.setVerticalAlignment("top").setWrap(true).setFontFamily("Inter");

  // Formatage des liens RichText pour les fichiers
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
}

/**
 * Harmonise les recommandations de prise de contact après analyse et tri.
 * N'écrit QUE sur la colonne Recommandation (col 9) pour préserver strictement les liens et les formats de téléphones.
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} resultsSheet
 * @returns {number} Nombre de candidats retenus en prise de contact
 */
function _optimizeContactRecommendations(resultsSheet) {
  const lastRow = resultsSheet.getLastRow();
  if (lastRow < 4) return 0;

  const numRows = lastRow - 3;
  // Lire uniquement Recommandation (col 9) et Note (col 10)
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
    // Écriture ciblée sur la colonne Recommandation uniquement
    resultsSheet.getRange(4, COL_INDEX.RECOMMENDATION, numRows, 1).setValues(recoColumnData);
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
