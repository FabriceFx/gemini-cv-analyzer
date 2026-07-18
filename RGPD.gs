/**
 * RGPD.gs
 * Gestion de la conformité, purge et anonymisation des données.
 */

/**
 * Supprime les CV du dossier Drive dont la date dépasse le délai de conservation RGPD.
 * Les place dans la corbeille par sécurité, anonymise les données dans la feuille, et écrit dans le journal.
 */
function purgeOldCVs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

  if (!configSheet || !resultsSheet) {
    SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser les feuilles via le menu '\u2699\ufe0f Initialiser / Réinitialiser les feuilles'.");
    return;
  }

  const config = getConfig(configSheet);
  const folderUrl = (config['URL du dossier Drive contenant les CVs'] || '').toString().trim();

  if (!folderUrl) {
    SpreadsheetApp.getUi().alert("Configuration manquante : l'URL du dossier Drive n'est pas renseignée.");
    return;
  }

  const data = configSheet.getRange("A:B").getValues();
  let retentionDays = 730; // 2 ans par défaut
  let foundConfig = false;

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === "Délai de rétention RGPD (jours)") {
      retentionDays = parseInt(data[i][1], 10);
      foundConfig = true;
      break;
    }
  }

  if (!foundConfig) {
    const response = SpreadsheetApp.getUi().alert(
      "Mise à jour requise",
      "Le paramètre RGPD n'a pas été trouvé. Souhaitez-vous utiliser la valeur par défaut de 730 jours (2 ans) ?",
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (response !== SpreadsheetApp.getUi().Button.YES) return;
  }

  if (isNaN(retentionDays) || retentionDays <= 0) {
    SpreadsheetApp.getUi().alert("Nettoyage désactivé : le délai de rétention est à 0 ou invalide.");
    return;
  }

  const folderId = getFolderIdFromUrl(folderUrl);
  if (!folderId) {
    SpreadsheetApp.getUi().alert("Erreur : l'URL du dossier Drive est invalide.");
    return;
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    SpreadsheetApp.getUi().alert("Erreur : impossible d'accéder au dossier Drive.");
    return;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const confirmResponse = SpreadsheetApp.getUi().alert(
    "🛡️ Confirmation nettoyage RGPD",
    `Vous allez mettre à la corbeille tous les CVs déposés AVANT le ${cutoffDate.toLocaleDateString()} (soit plus de ${retentionDays} jours) et anonymiser leurs lignes correspondantes.\n\nCette action est réversible depuis la corbeille Google Drive pendant 30 jours (les données du tableur, elles, seront anonymisées).\n\nConfirmer ?`,
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );
  if (confirmResponse !== SpreadsheetApp.getUi().Button.YES) {
    ss.toast("Nettoyage RGPD annulé.", "Annulé");
    return;
  }

  const files = folder.getFiles();
  let deletedCount = 0;
  let errorCount = 0;
  
  const idsToAnonymize = {};

  while (files.hasNext()) {
    const file = files.next();
    const mimeType = file.getMimeType();
    
    if ((mimeType === MimeType.PDF || mimeType === MimeType.GOOGLE_DOCS || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") && file.getDateCreated() < cutoffDate) {
      try {
        const fileId = file.getId();
        file.setTrashed(true);
        deletedCount++;
        idsToAnonymize[fileId] = true;
        logRGPDAction(fileId, "Mis à la corbeille et données anonymisées");
      } catch (trashErr) {
        Logger.log(`Impossible de traiter ${file.getName()} : ${trashErr.message}`);
        errorCount++;
      }
    }
  }
  
  if (Object.keys(idsToAnonymize).length > 0) {
    anonymizeResultsRowsBulk(resultsSheet, idsToAnonymize);
  }

  let purgeMessage = `${deletedCount} document${deletedCount > 1 ? 's' : ''} datant d'avant le ${cutoffDate.toLocaleDateString()} ${deletedCount > 1 ? 'ont été déplacés' : 'a été déplacé'} vers la corbeille et ${deletedCount > 1 ? 'anonymisés' : 'anonymisé'} dans le classeur.`;

  if (errorCount > 0) {
    purgeMessage += `\n\n⚠️ ${errorCount} fichier(s) n'ont pas pu être traités correctement.`;
  }
  if (deletedCount === 0 && errorCount === 0) {
    purgeMessage = `Aucun document à purger : tous les fichiers datent de moins de ${retentionDays} jours.`;
  }

  SpreadsheetApp.getUi().alert(`Nettoyage RGPD terminé :\n\n${purgeMessage}`);
}

/**
 * Remplace les données identifiantes par 'Anonymisé' pour plusieurs fichiers de manière optimisée.
 */
function anonymizeResultsRowsBulk(sheet, idsDict) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return;
  
  // Lecture optimisée en une seule fois (Colonnes A à M)
  const range = sheet.getRange(4, 1, lastRow - 3, 13);
  const data = range.getValues();
  let modified = false;
  
  for (let i = 0; i < data.length; i++) {
    const currentId = data[i][12]; // Colonne 13 (M) : index 12
    if (idsDict[currentId]) {
      data[i][0] = "Anonymisé"; // Candidat (A)
      data[i][1] = "Anonymisé"; // Email (B)
      data[i][2] = "Anonymisé"; // Téléphone (C)
      data[i][10] = "Document purgé"; // Fichier CV (K)
      modified = true;
    }
  }
  
  if (modified) {
    range.setValues(data);
  }
}

/**
 * Enregistre une trace d'action RGPD dans l'onglet Journal RGPD.
 */
function logRGPDAction(fileId, actionMsg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = ss.getSheetByName(RGPD_LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(RGPD_LOG_SHEET_NAME);
    logSheet.getRange("A1:C1").setValues([["Date", "ID Fichier", "Action"]])
      .setFontWeight("bold")
      .setBackground("#0f172a")
      .setFontColor("#ffffff");
    logSheet.setColumnWidth(1, 150);
    logSheet.setColumnWidth(2, 250);
    logSheet.setColumnWidth(3, 400);
  }
  logSheet.appendRow([new Date(), fileId, actionMsg]);
}
