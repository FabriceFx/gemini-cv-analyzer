/**
 * RGPD.gs
 * Gestion de la conformité, purge et pseudonymisation des données.
 */

/**
 * Supprime les CV du dossier Drive dont la date dépasse le délai de conservation RGPD.
 * Les place dans la corbeille par sécurité, pseudonymise les données d'identification dans la feuille, et écrit dans le journal.
 */
function purgeOldCVs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

  if (!resultsSheet) {
    SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser la feuille via le menu '⚙️ Initialiser / Réinitialiser les feuilles'.");
    return;
  }

  const config = getConfig();
  const folderUrl = (config.folderUrl || config['URL du dossier Drive contenant les CVs'] || '').toString().trim();

  if (!folderUrl) {
    SpreadsheetApp.getUi().alert("Configuration manquante : l'URL du dossier Drive n'est pas renseignée.");
    return;
  }

  const retentionDays = Number(config.retentionDays || config['Délai de rétention RGPD (jours)']) || 730;

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
    `Vous allez mettre à la corbeille tous les CVs déposés AVANT le ${cutoffDate.toLocaleDateString()} (soit plus de ${retentionDays} jours) et pseudonymiser leurs données d'identification.\n\nCette action est réversible depuis la corbeille Google Drive pendant 30 jours (les données du tableur seront pseudonymisées).\n\nConfirmer ?`,
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
    const fileName = file.getName();
    if (fileName.startsWith("tmp_")) continue;
    const mimeType = file.getMimeType();
    
    if (SUPPORTED_MIME_TYPES.includes(mimeType) && file.getDateCreated() < cutoffDate) {
      try {
        const fileId = file.getId();
        file.setTrashed(true);
        deletedCount++;
        idsToAnonymize[fileId] = true;
        logRGPDAction(fileId, "Mis à la corbeille et données pseudonymisées");
      } catch (trashErr) {
        Logger.log(`Impossible de traiter ${file.getName()} : ${trashErr.message}`);
        errorCount++;
      }
    }
  }
  
  if (Object.keys(idsToAnonymize).length > 0) {
    anonymizeResultsRowsBulk(resultsSheet, idsToAnonymize);
  }

  let purgeMessage = `${deletedCount} document${deletedCount > 1 ? 's' : ''} datant d'avant le ${cutoffDate.toLocaleDateString()} ${deletedCount > 1 ? 'ont été déplacés' : 'a été déplacé'} vers la corbeille et ${deletedCount > 1 ? 'pseudonymisés' : 'pseudonymisé'} dans le classeur.`;

  if (errorCount > 0) {
    purgeMessage += `\n\n⚠️ ${errorCount} fichier(s) n'ont pas pu être traités correctement.`;
  }
  if (deletedCount === 0 && errorCount === 0) {
    purgeMessage = `Aucun document à purger : tous les fichiers datent de moins de ${retentionDays} jours.`;
  }

  SpreadsheetApp.getUi().alert(`Nettoyage RGPD terminé :\n\n${purgeMessage}`);
}

/**
 * Remplace les données identifiantes par 'Pseudonymisé' pour les seuls fichiers purgés de manière ciblée.
 * Ne touche absolument pas aux autres lignes afin de préserver intacts leurs liens RichText et formats de téléphone.
 */
function anonymizeResultsRowsBulk(sheet, idsDict) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return;
  
  const numRows = lastRow - 3;
  const idValues = sheet.getRange(4, COL_INDEX.FILE_ID, numRows, 1).getValues();

  for (let i = 0; i < numRows; i++) {
    const currentId = (idValues[i][0] || '').toString().trim();
    if (idsDict[currentId]) {
      const rowIdx = 4 + i;
      sheet.getRange(rowIdx, 1, 1, 3).setValues([["Pseudonymisé", "Pseudonymisé", "Pseudonymisé"]]);
      sheet.getRange(rowIdx, COL_INDEX.FILE_LINK).setValue("Document purgé");
    }
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
