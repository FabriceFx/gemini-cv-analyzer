/**
 * Analyseur de CV & Système de Notation par IA
 * Développé en Apps Script pour Google Sheets
 * Intègre l'API Gemini pour l'analyse native des fichiers PDF
 */

/**
 * Fonction exécutée à l'ouverture du fichier.
 * Crée le menu personnalisé dans l'interface Google Sheets.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Analyseur de CV')
    .addItem('⚙️ Initialiser / Réinitialiser les feuilles', 'setupSheets')
    .addItem('🔑 Configurer la clé API', 'showSetApiKeyDialog')
    .addItem('🔍 Analyser les nouveaux CVs', 'analyzeCVs')
    .addSeparator()
    .addItem('📧 Générer les emails de réponse (Brouillons)', 'draftEmailsForCandidates')
    .addSeparator()
    .addItem('🛡️ Nettoyage RGPD des anciens CV', 'purgeOldCVs')
    .addSeparator()
    .addItem('🧹 Vider les résultats', 'clearResults')
    .addSeparator()
    .addItem('📖 Guide & bonnes pratiques', 'showGuide')
    .addToUi();
}

/**
 * Initialise et met en forme les onglets "Configuration" et "Résultats de l'Analyse".
 * Conserve les données saisies par l'utilisateur lors d'une réinitialisation.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // === 1. Feuille de configuration ===
  let configSheet = ss.getSheetByName("Configuration");
  let existingConfig = {};
  if (!configSheet) {
    configSheet = ss.insertSheet("Configuration");
  } else {
    // Conserver les saisies de l'utilisateur dans la colonne B avant d'effacer la feuille
    try {
      existingConfig.drive = configSheet.getRange("B4").getValue();
      existingConfig.job = configSheet.getRange("B5").getValue();
      existingConfig.model = configSheet.getRange("B6").getValue();
      existingConfig.criteria = configSheet.getRange("B7").getValue();
      existingConfig.prompt = configSheet.getRange("B8").getValue();
      existingConfig.retention = configSheet.getRange("B9").getValue();
    } catch(e) {}
    
    configSheet.clear();
    // Nettoyer les protections existantes
    configSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  }
  
  // Masquer le quadrillage pour un look "Application"
  configSheet.setHiddenGridlines(true);
  
  // Couleurs de l'interface (Inspiré de Tailwind CSS)
  const primaryColor = "#1e40af"; // Blue 800
  const bgLight = "#f8fafc";      // Slate 50
  const borderGrey = "#e2e8f0";   // Slate 200
  const textDark = "#0f172a";     // Slate 900
  const textMuted = "#64748b";    // Slate 500
  
  // Bannière d'en-tête
  configSheet.getRange("A1:C1").merge().setValue("⚙️ Configuration - Analyseur de CV AI")
    .setFontFamily("Inter")
    .setFontSize(14)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackgroundColor(primaryColor)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  
  configSheet.setRowHeight(1, 50);
  
  // Métadonnées de la configuration
  const storedKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const apiKeyStatus = storedKey ? '✅ Clé configurée en sécurité (menu → Configurer la clé API)' : '⚠️ Non configurée — utilisez le menu → Configurer la clé API';

  const configData = [
    ["Clé API Gemini", apiKeyStatus, "La clé est stockée de façon sécurisée (hors de cette feuille). Utilisez le menu '🔑 Configurer la clé API' pour la modifier."],
    ["URL du dossier Drive contenant les CVs", existingConfig.drive !== undefined ? existingConfig.drive : "", "Lien du dossier Google Drive contenant les CVs PDF (ex: https://drive.google.com/drive/folders/...)"],
    ["URL ou texte de l'annonce", existingConfig.job !== undefined ? existingConfig.job : "", "Entrez l'URL de l'offre d'emploi ou collez directement la description textuelle"],
    ["Modèle Gemini", existingConfig.model || "gemini-3.5-flash", "Sélectionnez le modèle d'IA (gemini-3.5-flash est recommandé)"],
    ["Critères spécifiques du recruteur", existingConfig.criteria !== undefined ? existingConfig.criteria : "", "Ex: 'Priorité aux compétences React, être bilingue anglais, note stricte' (optionnel)"],
    ["Prompt système", 
     existingConfig.prompt || "Agis en tant que Recruteur Senior. Je te fournis l'offre d'emploi suivante :\n{{JOB_DESCRIPTION}}\n\net le CV d'un candidat en PDF. Tu ne dois rien inventer et tu ne dois faire aucune interprétation : réfère-toi uniquement aux données explicites du CV et de l'offre d'emploi.\n\nConsignes spécifiques du recruteur :\n{{CRITERIA}}\n\nConsignes de mise en forme et de logique :\nFormat du texte : N'utilise jamais de puces (points ou tirets) pour séparer les idées dans les champs texte. Privilégie des parenthèses ou du texte fluide. Pour les compétences, indique le statut général (Oui / Non / Partiel) suivi des éléments précis entre parenthèses, par exemple : 'Oui (compétence X, compétence Y)' ou 'Partiel (compétence Z)'.\n\nIntitule ton rapport : 'Analyse des CV par l'IA'.", 
     "Le prompt système utilisé pour l'analyse. Laissez {{JOB_DESCRIPTION}} et {{CRITERIA}} intacts pour qu'ils soient remplacés automatiquement."],
    ["Délai de rétention RGPD (jours)", existingConfig.retention !== undefined ? existingConfig.retention : 730, "Les CV plus anciens seront supprimés lors du nettoyage (Ex: 730 pour 2 ans, 0 pour désactiver)"]
  ];
  
  // Appliquer le fond clair sur l'ensemble de l'interface
  configSheet.getRange("A2:C100").setBackgroundColor(bgLight);
  
  for (let i = 0; i < configData.length; i++) {
    const row = i + 3;
    configSheet.getRange(row, 1)
      .setValue(configData[i][0])
      .setFontWeight("bold")
      .setFontColor(textDark)
      .setFontFamily("Inter")
      .setVerticalAlignment("middle")
      .setBackgroundColor("#ffffff")
      .setBorder(true, true, true, true, false, false, borderGrey, SpreadsheetApp.BorderStyle.SOLID);
      
    configSheet.getRange(row, 2)
      .setValue(configData[i][1])
      .setFontFamily("Inter")
      .setFontColor(textDark)
      .setVerticalAlignment("middle")
      .setBackgroundColor("#ffffff")
      .setBorder(true, true, true, true, false, false, borderGrey, SpreadsheetApp.BorderStyle.SOLID);
      
    configSheet.getRange(row, 3)
      .setValue(configData[i][2])
      .setFontColor(textMuted)
      .setFontStyle("italic")
      .setFontFamily("Inter")
      .setVerticalAlignment("middle");
      
    configSheet.setRowHeight(row, 35);
  }
  
  // Agrandir la hauteur des lignes pour les champs longs (Critères et Prompt)
  configSheet.setRowHeight(7, 70);  // Saisie des critères
  configSheet.setRowHeight(8, 140); // Saisie du prompt système
  
  // Mise en forme des champs de saisie (Colonne B)
  const inputCells = configSheet.getRange("B3:B9");
  inputCells.setWrap(true).setFontSize(11);
  
  // Validation des données pour la sélection du modèle IA
  const modelCell = configSheet.getRange("B6");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"], true)
    .setAllowInvalid(true)
    .build();
  modelCell.setDataValidation(rule);
  
  // Formatage conditionnel du statut de la clé API
  const apiStatusCell = configSheet.getRange("B3");
  const rulesConfig = configSheet.getConditionalFormatRules();
  rulesConfig.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextStartsWith("✅")
    .setBackground("#dcfce7") // Green 100
    .setFontColor("#166534") // Green 800
    .setRanges([apiStatusCell])
    .build());
  rulesConfig.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextStartsWith("⚠️")
    .setBackground("#fff7ed") // Orange 50
    .setFontColor("#ea580c") // Orange 600
    .setRanges([apiStatusCell])
    .build());
  configSheet.setConditionalFormatRules(rulesConfig);
  
  // Protection de la feuille (UI/UX Safety)
  // L'utilisateur ne peut modifier que la colonne B
  try {
    const protection = configSheet.protect().setDescription("Protection interface config");
    protection.setWarningOnly(false);
    protection.setUnprotectedRanges([inputCells]);
  } catch(e) {}
  
  configSheet.setColumnWidth(1, 280);
  configSheet.setColumnWidth(2, 500);
  configSheet.setColumnWidth(3, 350);
  
  // === 2. Feuille des résultats ===
  let resultsSheet = ss.getSheetByName("Résultats de l'Analyse");
  if (!resultsSheet) {
    resultsSheet = ss.insertSheet("Résultats de l'Analyse");
  } else {
    resultsSheet.clear();
    resultsSheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
    resultsSheet.getBandings().forEach(b => b.remove());
  }
  
  resultsSheet.setHiddenGridlines(true);
  
  // Ligne 1 : Bannière de titre
  resultsSheet.getRange("A1:M1").merge().setValue("Analyse des CV par l'IA")
    .setFontFamily("Inter")
    .setFontSize(14)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackgroundColor(primaryColor)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  resultsSheet.setRowHeight(1, 50);
  
  // Ligne 2 : Boîte de synthèse globale
  resultsSheet.getRange("A2:M2").merge().setValue("Synthèse globale : En attente du lancement de l'analyse pour générer les conseils de session...")
    .setFontFamily("Inter")
    .setFontSize(11)
    .setFontStyle("italic")
    .setFontColor("#475569") // Slate 600
    .setBackgroundColor("#f1f5f9") // Slate 100
    .setVerticalAlignment("middle")
    .setWrap(true)
    .setBorder(false, false, true, false, false, false, borderGrey, SpreadsheetApp.BorderStyle.SOLID);
  resultsSheet.setRowHeight(2, 55);
  
  // Ligne 3 : En-têtes du tableau
  const headers = [
    "Candidat", 
    "Email",
    "Téléphone",
    "Expérience pertinente", 
    "Formation & diplômes", 
    "Top 3 compétences", 
    "Points forts", 
    "Points de vigilance / questions", 
    "Recommandation", 
    "Note / 5", 
    "Fichier CV", 
    "Date d'analyse", 
    "ID fichier"
  ];
  
  const headerRange = resultsSheet.getRange(3, 1, 1, headers.length);
  headerRange.setValues([headers])
    .setFontFamily("Inter")
    .setFontSize(11)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackgroundColor("#0f172a") // Slate 900
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  
  resultsSheet.setRowHeight(3, 40);
  resultsSheet.setFrozenRows(3);
  
  // Protection des en-têtes (Lignes 1 à 3)
  try {
    const headerProtection = resultsSheet.getRange("A1:M3").protect().setDescription("Protection en-têtes résultats");
    headerProtection.setWarningOnly(true);
  } catch(e) {}
  
  // Mise en forme et largeur des colonnes de résultats
  resultsSheet.setColumnWidth(1, 150); // Nom du Candidat
  resultsSheet.setColumnWidth(2, 180); // Email
  resultsSheet.setColumnWidth(3, 120); // Téléphone
  resultsSheet.setColumnWidth(4, 220); // Expérience pertinente
  resultsSheet.setColumnWidth(5, 200); // Formation & Diplômes
  resultsSheet.setColumnWidth(6, 220); // Top 3 compétences
  resultsSheet.setColumnWidth(7, 280); // Points Forts
  resultsSheet.setColumnWidth(8, 280); // Points de vigilance / Questions
  resultsSheet.setColumnWidth(9, 160); // Recommandation
  resultsSheet.setColumnWidth(10, 90);  // Note / 5
  resultsSheet.setColumnWidth(11, 180); // Fichier CV
  resultsSheet.setColumnWidth(12, 140); // Date d'analyse
  resultsSheet.setColumnWidth(13, 120); // ID du fichier
  
  resultsSheet.hideColumns(13);
  
  // Row banding (lignes alternées)
  resultsSheet.getRange("A3:M1000").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  
  // Définir les propriétés de formatage par défaut à partir de la ligne 4
  resultsSheet.getRange("A4:A").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontWeight("bold").setFontColor(primaryColor);
  resultsSheet.getRange("B4:H").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontSize(10).setFontColor(textDark);
  resultsSheet.getRange("I4:J").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontWeight("bold").setFontFamily("Inter");
  resultsSheet.getRange("K4:L").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontFamily("Inter").setFontColor(textMuted);
  
  // Configurer le formatage conditionnel pour la "Recommandation" (Colonne I)
  const recommendationRange = resultsSheet.getRange("I4:I");
  const ruleGreen = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("À contacter")
    .setBackground("#dcfce7") // Green 100
    .setFontColor("#166534") // Green 800
    .setRanges([recommendationRange])
    .build();
    
  const ruleYellow = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("À garder en vivier")
    .setBackground("#fef9c3") // Yellow 100
    .setFontColor("#854d0e") // Yellow 800
    .setRanges([recommendationRange])
    .build();
    
  const ruleRed = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("À refuser")
    .setBackground("#fee2e2") // Red 100
    .setFontColor("#991b1b") // Red 800
    .setRanges([recommendationRange])
    .build();
    
  // Configurer le formatage conditionnel pour la "Note / 5" (Colonne J)
  const noteRange = resultsSheet.getRange("J4:J");
  const ruleNoteGreen = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThanOrEqualTo(4)
    .setBackground("#dcfce7")
    .setFontColor("#166534")
    .setRanges([noteRange])
    .build();

  const ruleNoteYellow = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberEqualTo(3)
    .setBackground("#fef9c3")
    .setFontColor("#854d0e")
    .setRanges([noteRange])
    .build();

  const ruleNoteRed = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThanOrEqualTo(2)
    .setBackground("#fee2e2")
    .setFontColor("#991b1b")
    .setRanges([noteRange])
    .build();
    
  const rules = resultsSheet.getConditionalFormatRules();
  rules.push(ruleGreen, ruleYellow, ruleRed, ruleNoteGreen, ruleNoteYellow, ruleNoteRed);
  resultsSheet.setConditionalFormatRules(rules);
  
  // Supprimer les feuilles inutiles (ex: "Feuille 1")
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sheetName = sheets[i].getName();
    if (sheetName !== "Configuration" && sheetName !== "Résultats de l'Analyse") {
      ss.deleteSheet(sheets[i]);
    }
  }
  
  ss.toast("Feuilles configurées avec succès.", "✅ Initialisation réussie");
}

/**
 * Met à jour visuellement la cellule d'état de la clé API dans la feuille Configuration.
 */
function updateApiKeyStatusUI() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Configuration");
  if (!configSheet) return;
  
  const storedKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const apiKeyStatus = storedKey ? '✅ Clé configurée en sécurité (menu → Configurer la clé API)' : '⚠️ Non configurée — utilisez le menu → Configurer la clé API';
  
  configSheet.getRange("B3").setValue(apiKeyStatus);
}

/**
 * Vide le tableau des résultats d'analyse (après confirmation de l'utilisateur).
 */
function clearResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Résultats de l'Analyse");
  if (!sheet) {
    ss.toast("La feuille des résultats n'existe pas. Veuillez l'initialiser d'abord.", "Erreur ⚠️");
    return;
  }
  
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    "Confirmation de suppression", 
    "Voulez-vous vraiment vider tout le tableau des résultats d'analyse ? Cette opération est définitive.", 
    ui.ButtonSet.YES_NO
  );
  
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
 * Fonction principale : Liste les PDF du dossier, les analyse et les note par rapport à l'offre d'emploi via l'API Gemini.
 */
function analyzeCVs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Configuration");
  const resultsSheet = ss.getSheetByName("Résultats de l'Analyse");
  
  if (!configSheet || !resultsSheet) {
    SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser les feuilles via le menu '\u2699\ufe0f Initialiser / Réinitialiser les feuilles'.");
    return;
  }
  
  // Constantes de sécurité d'exécution (Google coupe après 6 min, on arrête proprement à 5 min)
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 5 * 60 * 1000;
  
  // Récupérer les valeurs de configuration
  const config = getConfig(configSheet);
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
                 || (config['Clé API Gemini'] || '').toString().trim();
  const folderUrl = (config['URL du dossier Drive contenant les CVs'] || '').toString().trim();
  const annonceInput = (config["URL ou texte de l'annonce"] || '').toString().trim();
  const model = (config['Modèle Gemini'] || 'gemini-3.5-flash').toString().trim();
  const criteria = (config['Critères spécifiques du recruteur'] || '').toString().trim();
  const rawSystemPrompt = (config['Prompt système'] || '').toString().trim();
  
  // Sécurité : le prompt doit contenir les deux balises (placeholders) pour être utilisable
  const DEFAULT_PROMPT = "Agis en tant que Recruteur Senior. Je te fournis l'offre d'emploi suivante :\n{{JOB_DESCRIPTION}}\n\net le CV d'un candidat en PDF. Tu ne dois rien inventer et tu ne dois faire aucune interprétation : réfère-toi uniquement aux données explicites du CV et de l'offre d'emploi.\n\nConsignes spécifiques du recruteur :\n{{CRITERIA}}\n\nConsignes de mise en forme et de logique :\nFormat du texte : N'utilise jamais de puces (points ou tirets) pour séparer les idées dans les champs texte. Privilégie des parenthèses ou du texte fluide. Pour les compétences, indique le statut général (Oui / Non / Partiel) suivi des éléments précis entre parenthèses. Intitule ton rapport : 'Analyse des CV par l'IA'.";
  const systemPrompt = (rawSystemPrompt.includes('{{JOB_DESCRIPTION}}') && rawSystemPrompt.includes('{{CRITERIA}}'))
    ? rawSystemPrompt
    : DEFAULT_PROMPT;
  
  // Validations de base
  if (!apiKey) {
    SpreadsheetApp.getUi().alert("Configuration requise : veuillez saisir votre clé API Gemini via le menu '\uD83D\uDD11 Configurer la clé API'.");
    return;
  }
  if (!folderUrl) {
    SpreadsheetApp.getUi().alert("Configuration requise : veuillez fournir l'URL du dossier Google Drive contenant les CVs (cellule B4).");
    return;
  }
  if (!annonceInput) {
    SpreadsheetApp.getUi().alert("Configuration requise : veuillez renseigner l'annonce (URL ou texte collé) dans la cellule B5.");
    return;
  }
  
  // Extraction de l'ID du dossier
  const folderId = getFolderIdFromUrl(folderUrl);
  if (!folderId) {
    SpreadsheetApp.getUi().alert("Erreur de configuration : l'URL du dossier Drive semble invalide. Vérifiez qu'elle commence par https://drive.google.com/drive/folders/...");
    return;
  }
  
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch(e) {
    SpreadsheetApp.getUi().alert(`Erreur d'accès Drive : impossible d'accéder au dossier. Assurez-vous d'avoir les permissions requises. Détail : ${e.message}`);
    return;
  }
  
  // Récupérer ou extraire la description de l'offre d'emploi
  let jobDescription = "";
  if (annonceInput.startsWith("http://") || annonceInput.startsWith("https://")) {
    ss.toast("Chargement de l'annonce depuis l'URL...", "Annonce 🌐", 10);
    try {
      const rawHtml = fetchJobDescription(annonceInput);
      ss.toast("Nettoyage de la description avec l'IA...", "Annonce 🧠", 10);
      jobDescription = extractJobDescriptionWithGemini(rawHtml, apiKey, model);
    } catch(e) {
      Logger.log(`Échec du scraping de l'annonce : ${e.message}`);
      ss.toast("Échec du scraping. Tentative de lecture du texte brut de la page...", "Alerte ⚠️", 10);
      try {
        jobDescription = fetchJobDescription(annonceInput).substring(0, 15000);
      } catch(fetchError) {
        SpreadsheetApp.getUi().alert("Erreur de récupération : impossible d'accéder à l'annonce en ligne. Si le site est protégé ou privé, veuillez copier-coller directement son texte dans la cellule B5.");
        return;
      }
    }
  } else {
    jobDescription = annonceInput;
  }
  
  // Identifier les fichiers déjà traités (À partir de la ligne 4, l'ID est dans la colonne 13)
  const processedIds = {};
  const lastRow = resultsSheet.getLastRow();
  if (lastRow > 3) {
    const existingIds = resultsSheet.getRange(4, 13, lastRow - 3, 1).getValues();
    for (let i = 0; i < existingIds.length; i++) {
      const id = existingIds[i][0].toString().trim();
      if (id) {
        processedIds[id] = true;
      }
    }
  }
  
  // Récupérer les fichiers PDF du dossier cible
  const files = folder.getFiles();
  const filesToProcess = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === "application/pdf" && !processedIds[file.getId()]) {
      filesToProcess.push(file);
    }
  }
  
  // Dossier vide (aucun PDF) vs tout déjà traité
  if (filesToProcess.length === 0) {
    const totalPdfs = folder.getFilesByType(MimeType.PDF);
    const hasPdfs = totalPdfs.hasNext();
    if (!hasPdfs) {
      SpreadsheetApp.getUi().alert("Dossier vide : aucun fichier PDF n'a été trouvé dans ce dossier Google Drive.\n\nVérifiez que l'URL du dossier est correcte et que des CVs au format .pdf y ont bien été déposés.");
    } else {
      ss.toast("Tous les CVs de ce dossier ont déjà été analysés !", "Terminé ✅");
    }
    return;
  }
  
  ss.toast(`Début de l'analyse : ${filesToProcess.length} nouveau(x) CV(s) détecté(s).`, "Lancement 🚀");
  
  let successCount = 0;
  let errorCount = 0;
  let stoppedByTimeout = false;
  
  for (let k = 0; k < filesToProcess.length; k++) {
    // 1. Vérification du temps restant (Arrêt de sécurité)
    if (Date.now() - startTime > MAX_EXECUTION_TIME) {
      ss.toast("Temps d'exécution maximal approché. Mise en pause.", "Sécurité ⏳", 5);
      stoppedByTimeout = true;
      break;
    }
    
    const file = filesToProcess[k];
    const fileName = file.getName();
    ss.toast(`Traitement en cours (${k + 1}/${filesToProcess.length}) : ${fileName}`, "Analyse 🔍");
    
    try {
      const analysis = analyzeSinglePDF(file, apiKey, model, jobDescription, criteria, systemPrompt);
      
      // Ajouter la ligne formatée (13 colonnes)
      const newRow = [
        analysis.candidateName || "Inconnu",
        analysis.email || "Non renseigné",
        analysis.phone ? "'" + analysis.phone : "Non renseigné",
        analysis.experience || "",
        analysis.education || "",
        analysis.skills || "",
        analysis.strengths || "",
        analysis.weaknesses || "",
        analysis.recommendation || "À garder en vivier",
        analysis.score || 1,
        fileName, // Placeholder for RichTextValue
        new Date(),
        file.getId()
      ];
      
      resultsSheet.appendRow(newRow);
      
      // Appliquer les alignements et créer le lien cliquable (RichText)
      const addedIndex = resultsSheet.getLastRow();
      
      const richTextLink = SpreadsheetApp.newRichTextValue()
        .setText(fileName)
        .setLinkUrl(file.getUrl())
        .build();
      
      resultsSheet.getRange(addedIndex, 1, 1, 13).setVerticalAlignment("top").setWrap(true).setFontFamily("Inter");
      resultsSheet.getRange(addedIndex, 9).setHorizontalAlignment("center").setFontWeight("bold"); // Recommandation
      resultsSheet.getRange(addedIndex, 10).setHorizontalAlignment("center").setFontWeight("bold").setNumberFormat("0"); // Note
      resultsSheet.getRange(addedIndex, 11).setHorizontalAlignment("center").setRichTextValue(richTextLink); // Fichier
      resultsSheet.getRange(addedIndex, 12).setHorizontalAlignment("center").setNumberFormat("dd/MM/yyyy HH:mm"); // Date
      
      SpreadsheetApp.flush();
      successCount++;
      
      // Attendre 1,5 seconde entre les requêtes (pour éviter les limites de l'API)
      Utilities.sleep(1500);
      
    } catch(err) {
      Logger.log(`Erreur CV (${fileName}) : ${err.message}`);
      errorCount++;
      
      // Ajouter une ligne d'erreur
      const errorRow = [
        "Erreur analyse",
        "",
        "",
        "",
        "",
        "",
        `Une erreur s'est produite : ${err.message}`,
        "",
        "À refuser",
        1,
        fileName, // Placeholder for RichTextValue
        new Date(),
        file.getId()
      ];
      
      resultsSheet.appendRow(errorRow);
      const addedIndex = resultsSheet.getLastRow();
      
      const richTextLink = SpreadsheetApp.newRichTextValue()
        .setText(fileName)
        .setLinkUrl(file.getUrl())
        .build();
        
      resultsSheet.getRange(addedIndex, 1, 1, 13).setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontColor("#dc2626");
      resultsSheet.getRange(addedIndex, 11).setHorizontalAlignment("center").setRichTextValue(richTextLink);
      SpreadsheetApp.flush();
    }
  }
  
  // Trier les lignes (à partir de la ligne 4) par Note décroissante (Colonne 10)
  const finalLastRow = resultsSheet.getLastRow();
  if (finalLastRow > 3) {
    resultsSheet.getRange(4, 1, finalLastRow - 3, 13).sort({column: 10, ascending: false});
  }
  
  // Générer le conseil de synthèse globale de la session
  const currentLastRow = resultsSheet.getLastRow();
  if (currentLastRow > 3) {
    const candidatesData = resultsSheet.getRange(4, 1, currentLastRow - 3, 10).getValues();
    const summaryList = [];
    for (let idx = 0; idx < candidatesData.length; idx++) {
      summaryList.push(`- ${candidatesData[idx][0]} : Note ${candidatesData[idx][9]}/5, Recommandation: ${candidatesData[idx][8]}`);
    }
    
    try {
      ss.toast("Génération de la synthèse de session...", "Synthèse 🧠", 10);
      const sessionSynthesis = generateSessionSynthesis(summaryList.join("\n"), jobDescription, apiKey, model);
      resultsSheet.getRange("A2").setValue(`Synthèse globale : ${sessionSynthesis}`);
    } catch(synthErr) {
      Logger.log(`Erreur synthèse globale : ${synthErr.message}`);
      resultsSheet.getRange("A2").setValue("Synthèse globale : Analyse terminée. Veuillez examiner les profils recommandés ci-dessous.");
    }
  }
  
  let endMessage = `Analyse terminée avec succès pour ${successCount} CVs.`;
  if (errorCount > 0) {
    endMessage += ` ${errorCount} fichier(s) en erreur.`;
  }
  if (stoppedByTimeout) {
    endMessage += "\n\n⚠️ L'analyse a été mise en pause automatiquement pour respecter la limite de temps de Google. Veuillez cliquer à nouveau sur 'Analyser les nouveaux CVs' pour traiter le reste des candidats de votre dossier.";
  }
  
  SpreadsheetApp.getUi().alert(`Analyse des CV par l'IA : ${endMessage}`);
}

/**
 * Lit toutes les valeurs de configuration depuis la feuille (colonne A pour les libellés)
 * et retourne un objet simple {libellé: valeur}. Résiste aux insertions de lignes.
 */
function getConfig(configSheet) {
  const data = configSheet.getRange('A:B').getValues();
  const config = {};
  data.forEach(row => {
    if (row[0]) config[row[0].toString()] = row[1];
  });
  return config;
}

/**
 * Extrait l'identifiant (25+ caractères) du dossier Google Drive à partir d'un lien complet.
 */
function getFolderIdFromUrl(url) {
  if (!url) return null;
  const matches = url.match(/folders\/([a-zA-Z0-9-_]{25,})/);
  if (matches && matches[1]) {
    return matches[1];
  }
  if (url.match(/^[a-zA-Z0-9-_]{25,}$/)) {
    return url;
  }
  return null;
}

/**
 * Récupère le contenu HTML d'une page web (URL) et retourne le texte brut (scraping).
 */
function fetchJobDescription(url) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  
  const code = response.getResponseCode();
  if (code === 403 || code === 401) {
    throw new Error(`Accès refusé par le site (HTTP ${code}). Ce site protège son contenu contre la lecture automatique. Veuillez copier-coller le texte de l'annonce directement dans la cellule B5.`);
  }
  if (code !== 200) {
    throw new Error(`Erreur de connexion HTTP ${code}. L'annonce est peut-être temporairement inaccessible.`);
  }
  
  const html = response.getContentText();
  
  // Nettoyage basique du HTML
  const text = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Sécurité : si le texte résultant est trop court, la page bloque probablement les robots
  if (text.length < 200) {
    throw new Error(`La page de l'annonce semble vide ou protégée contre le scraping (${text.length} caractères récupérés). Veuillez copier-coller directement le texte de l'annonce dans la cellule B5.`);
  }
    
  return text;
}

/**
 * Nettoie et structure le texte brut récupéré d'une annonce web à l'aide de l'IA Gemini.
 */
function extractJobDescriptionWithGemini(rawText, apiKey, model) {
  const truncatedText = rawText.substring(0, 45000);
  
  const systemInstruction = "Vous êtes un assistant spécialisé dans le recrutement de talents. Votre but est d'extraire la fiche descriptive d'un poste de manière claire et organisée en français à partir de texte brut.";
  const userPrompt = `Voici le texte extrait de la page web de l'annonce. Extrayez uniquement :\n- Le titre du poste et l'entreprise\n- Les missions principales\n- Les compétences exigées et profil recherché (XP, techno, diplôme)\n- Autres modalités (télétravail, salaire, localisation)\n\nNe conservez rien d'autre (ignorez les menus du site, les liens externes, etc.).\n\nTexte brut :\n${truncatedText}`;
                   
  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: userPrompt }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.1
    }
  };
  
  const responseText = callGeminiAPI(model, payload, apiKey);
  const json = JSON.parse(responseText);
  
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text;
  }
  throw new Error("L'API a retourné un format vide lors du nettoyage de l'offre d'emploi.");
}

/**
 * Analyse un CV au format PDF en utilisant la capacité multimodale (inlineData) de Gemini.
 * Injecte le fichier PDF directement dans le prompt de l'IA.
 */
function analyzeSinglePDF(file, apiKey, model, jobDescription, criteria, systemPrompt) {
  // Sécurité : vérifier la taille du fichier avant lecture (la limite de l'API est d'environ 20 Mo)
  const fileSizeBytes = file.getSize();
  const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20 MB
  if (fileSizeBytes > MAX_PDF_SIZE) {
    throw new Error(`Le fichier "${file.getName()}" est trop volumineux (${Math.round(fileSizeBytes / 1024 / 1024)} MB). La taille maximale acceptée est de 20 MB.`);
  }
  if (fileSizeBytes === 0) {
    throw new Error(`Le fichier "${file.getName()}" est vide (0 octet). Vérifiez que le PDF est valide.`);
  }

  let blob, base64Data;
  try {
    blob = file.getBlob();
    base64Data = Utilities.base64Encode(blob.getBytes());
  } catch(e) {
    throw new Error(`Impossible de lire le fichier PDF "${file.getName()}". Il est peut-être corrompu ou protégé par un mot de passe. Détail : ${e.message}`);
  }
  
  // Remplacer les balises dans le prompt par les valeurs saisies
  const finalPrompt = systemPrompt
    .replace("{{JOB_DESCRIPTION}}", jobDescription)
    .replace("{{CRITERIA}}", criteria || "Aucun critère particulier spécifié.");
    
  // Définir le schéma (JSON Schema) pour garantir que l'IA respecte les colonnes de notre tableau
  const responseSchema = {
    type: "OBJECT",
    properties: {
      candidateName: {
        type: "STRING",
        description: "Nom et Prénom du candidat. Écrire 'Inconnu' si introuvable."
      },
      email: {
        type: "STRING",
        description: "Adresse email du candidat. Écrire 'Non renseigné' si introuvable."
      },
      phone: {
        type: "STRING",
        description: "Numéro de téléphone du candidat. Écrire 'Non renseigné' si introuvable."
      },
      experience: {
        type: "STRING",
        description: "Années d'expérience pertinentes par rapport aux critères de l'offre. Ex: '3 ans d'XP en gestion de projet (vs 5 demandés)'. Ne pas utiliser de listes à puces."
      },
      education: {
        type: "STRING",
        description: "Formation et diplômes, en insistant sur le niveau d'études ou spécialisations requis par l'offre. Ne pas utiliser de listes à puces."
      },
      skills: {
        type: "STRING",
        description: "Top 3 compétences techniques maîtrisées avec statut : 'Oui', 'Non', ou 'Partiel', suivi des détails entre parenthèses. Ex: 'Oui (React, TypeScript) / Partiel (Docker)'. Ne pas utiliser de listes à puces."
      },
      strengths: {
        type: "STRING",
        description: "Points forts du profil par rapport au poste (texte fluide, pas de puces ni tirets, séparé par des parenthèses ou virgules si besoin)."
      },
      weaknesses: {
        type: "STRING",
        description: "Points de vigilance ou questions précises à poser en entretien (texte fluide, pas de puces ni tirets, séparé par des parenthèses ou virgules si besoin)."
      },
      recommendation: {
        type: "STRING",
        description: "Doit correspondre strictement à l'une de ces 3 valeurs textuelles : 'À contacter', 'À garder en vivier', ou 'À refuser'."
      },
      score: {
        type: "INTEGER",
        description: "Score global sous forme de note entière de 1 à 5 (1 étant faible adéquation et 5 adéquation idéale)."
      }
    },
    required: [
      "candidateName", 
      "email",
      "phone",
      "experience", 
      "education", 
      "skills", 
      "strengths", 
      "weaknesses", 
      "recommendation", 
      "score"
    ]
  };
  
  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: finalPrompt },
        { 
          inlineData: {
            mimeType: "application/pdf",
            data: base64Data
          }
        }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.1
    }
  };
  
  const responseText = callGeminiAPI(model, payload, apiKey);
  const jsonResponse = JSON.parse(responseText);
  
  if (jsonResponse.candidates && jsonResponse.candidates[0] && jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts[0]) {
    const rawTextOutput = jsonResponse.candidates[0].content.parts[0].text;
    return parseJsonSafely(rawTextOutput);
  }
  throw new Error("L'API Gemini n'a pas renvoyé de résultats valides pour ce fichier.");
}

/**
 * Génère une phrase de synthèse globale et un conseil pour la session de recrutement.
 */
function generateSessionSynthesis(candidatesSummary, jobDescription, apiKey, model) {
  const systemInstruction = "Vous êtes un Recruteur Senior conseil. Votre rôle est de donner un conseil final en une seule phrase après l'analyse de plusieurs CVs.";
  const prompt = `Voici la description du poste :\n${jobDescription}\n\nVoici le résumé des candidats évalués :\n${candidatesSummary}\n\nRédigez une unique phrase de synthèse de conseil et d'orientation actionnable pour guider le recruteur face à cette session de candidatures (ex: s'il faut lancer les entretiens immédiatement avec les meilleurs profils, élargir la recherche, ou revoir les critères de l'annonce). Soyez direct, professionnel et concis. Ne dépassez pas 35 mots.`;
               
  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.2
    }
  };
  
  const responseText = callGeminiAPI(model, payload, apiKey);
  const json = JSON.parse(responseText);
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text.trim();
  }
  throw new Error("Réponse vide de l'API pour la synthèse de session.");
}

/**
 * Fonction d'appel à l'API Gemini avec gestion des tentatives et du délai d'attente (limites de requêtes HTTP 429).
 */
function callGeminiAPI(model, payload, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const maxRetries = 3;
  let delay = 2500;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    
    if (code === 200) {
      return text;
    }
    
    if (code === 429) {
      Logger.log(`API Gemini (429 Rate Limit) - Tentative ${attempt + 1}/${maxRetries} - En attente...`);
      Utilities.sleep(delay);
      delay *= 2;
      continue;
    }
    
    // Extraire le message d'erreur détaillé de la réponse de l'API
    let errorMsg = `Erreur HTTP ${code}`;
    try {
      const errJson = JSON.parse(text);
      if (errJson && errJson.error && errJson.error.message) {
        errorMsg = errJson.error.message;
      }
    } catch(e) {}
    
    // Fournir des conseils clairs pour les codes d'erreur courants
    if (code === 400) {
      throw new Error(`Requête invalide (HTTP 400). Le PDF est peut-être trop complexe ou l'annonce contient des caractères non supportés. Détail : ${errorMsg}`);
    }
    if (code === 401) {
      throw new Error("Clé API Gemini invalide ou expirée (HTTP 401). Veuillez vérifier votre clé dans le menu '\uD83D\uDD11 Configurer la clé API'.");
    }
    if (code === 403) {
      throw new Error("Accès refusé par l'API Gemini (HTTP 403). Vérifiez que votre clé API a bien accès à l'API Gemini dans Google AI Studio.");
    }
    if (code === 500 || code === 503) {
      throw new Error(`Le service Gemini est temporairement indisponible (HTTP ${code}). Veuillez réessayer dans quelques minutes.`);
    }
    
    throw new Error(errorMsg);
  }
  
  throw new Error("Le service API Gemini est saturé (Rate limit). Veuillez réessayer ultérieurement.");
}

/**
 * Analyse et extrait le format JSON de la réponse de l'IA de manière sécurisée et robuste.
 */
function parseJsonSafely(text) {
  let cleaned = text.trim();
  
  // Extraction sécurisée par RegEx (capture l'objet JSON central en ignorant le texte avant/après)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch(e) {
      // Continue vers le bloc try/catch global si l'extraction par regex échoue
    }
  }
  
  try {
    return JSON.parse(cleaned);
  } catch(e) {
    // Suppression explicite des balises de code Markdown en dernier recours
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
      try {
        return JSON.parse(cleaned);
      } catch(nestedErr) {}
    }
    throw new Error(`Impossible de décoder l'analyse IA. Assurez-vous que l'annonce est compréhensible. Détail : ${e.message}`);
  }
}

/**
 * Supprime les CV du dossier Drive dont la date dépasse le délai de conservation RGPD.
 * Les place dans la corbeille par sécurité (récupérables pendant 30 jours).
 */
function purgeOldCVs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Configuration");
  
  if (!configSheet) {
    SpreadsheetApp.getUi().alert("Erreur : veuillez d'abord initialiser les feuilles via le menu '\u2699\ufe0f Initialiser / Réinitialiser les feuilles'.");
    return;
  }
  
  // Utilise getConfig() pour récupérer la configuration de manière sécurisée
  const config = getConfig(configSheet);
  const folderUrl = (config['URL du dossier Drive contenant les CVs'] || '').toString().trim();
  
  if (!folderUrl) {
    SpreadsheetApp.getUi().alert("Configuration manquante : l'URL du dossier Drive n'est pas renseignée dans la feuille Configuration. Veuillez la saisir (cellule B4) avant de lancer le nettoyage RGPD.");
    return;
  }
  
  // Tente de trouver le paramètre de rétention RGPD (supporte les anciennes et nouvelles configurations)
  const data = configSheet.getRange("A:B").getValues();
  let retentionDays = 730; // Default to 2 years if not found
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
      "Le paramètre RGPD n'a pas été trouvé dans votre feuille de configuration (car elle a été initialisée avec l'ancienne version). Souhaitez-vous utiliser la valeur par défaut de 730 jours (2 ans) ?", 
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (response !== SpreadsheetApp.getUi().Button.YES) {
      return;
    }
  }
  
  if (isNaN(retentionDays) || retentionDays <= 0) {
    SpreadsheetApp.getUi().alert("Nettoyage désactivé : le délai de rétention est à 0 ou invalide. Modifiez la valeur dans la cellule correspondante de la feuille Configuration.");
    return;
  }
  
  const folderId = getFolderIdFromUrl(folderUrl);
  if (!folderId) {
    SpreadsheetApp.getUi().alert("Erreur : l'URL du dossier Drive est invalide. Vérifiez la cellule B4 de la feuille Configuration.");
    return;
  }
  
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch(e) {
    SpreadsheetApp.getUi().alert("Erreur : impossible d'accéder au dossier Drive. Assurez-vous d'avoir les droits de modification sur ce dossier.");
    return;
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  // Confirmation obligatoire avant toute suppression (action irréversible)
  const confirmResponse = SpreadsheetApp.getUi().alert(
    "🛡️ Confirmation nettoyage RGPD",
    `Vous allez mettre à la corbeille tous les CVs déposés AVANT le ${cutoffDate.toLocaleDateString()} (soit plus de ${retentionDays} jours).\n\nCette action est réversible depuis la corbeille Google Drive pendant 30 jours.\n\nConfirmer ?`,
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );
  if (confirmResponse !== SpreadsheetApp.getUi().Button.YES) {
    ss.toast("Nettoyage RGPD annulé.", "Annulé");
    return;
  }
  
  const files = folder.getFilesByType(MimeType.PDF);
  let deletedCount = 0;
  let errorCount = 0;
  
  // On utilise setTrashed(true) pour envoyer à la corbeille au lieu d'une suppression définitive par sécurité
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < cutoffDate) {
      try {
        file.setTrashed(true);
        deletedCount++;
      } catch(trashErr) {
        Logger.log(`Impossible de supprimer ${file.getName()} : ${trashErr.message}`);
        errorCount++;
      }
    }
  }
  
  let purgeMessage = `${deletedCount} CV(s) datant d'avant le ${cutoffDate.toLocaleDateString()} ont été déplacés vers la corbeille de votre Google Drive.`;
  if (errorCount > 0) {
    purgeMessage += `\n\n⚠️ ${errorCount} fichier(s) n'ont pas pu être supprimés (droits insuffisants ou fichiers partagés en lecture seule).`;
  }
  if (deletedCount === 0 && errorCount === 0) {
    purgeMessage = `Aucun CV à supprimer : tous les fichiers du dossier datent de moins de ${retentionDays} jours.`;
  }
  
  SpreadsheetApp.getUi().alert(`Nettoyage RGPD terminé :\n\n${purgeMessage}`);
}

/**
 * Affiche une fenêtre modale HTML contenant la méthodologie et les bonnes pratiques d'utilisation de l'outil.
 */
function showGuide() {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Inter', sans-serif;
          padding: 24px;
          color: #334155;
          font-size: 14px;
          line-height: 1.6;
          margin: 0;
          background-color: #ffffff;
        }
        h2 {
          color: #0f172a;
          margin-top: 0;
          font-size: 20px;
          font-weight: 700;
          border-bottom: 2px solid #f1f5f9;
          padding-bottom: 12px;
          margin-bottom: 20px;
        }
        h3 {
          color: #1e40af;
          font-size: 15px;
          font-weight: 600;
          margin-top: 24px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        p {
          margin-top: 0;
          margin-bottom: 16px;
        }
        .highlight-box {
          background-color: #f8fafc;
          border-left: 4px solid #3b82f6;
          padding: 16px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 15px;
          color: #0f172a;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .success-box {
          background-color: #f0fdf4;
          border: 1px solid #bbf7d0;
          padding: 16px;
          border-radius: 6px;
          font-size: 13.5px;
          color: #166534;
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .icon { font-size: 18px; }
        hr {
          border: 0;
          border-top: 1px solid #e2e8f0;
          margin: 24px 0;
        }
        .footer-btn {
          margin-top: 24px;
          text-align: right;
        }
        .btn {
          background-color: #f1f5f9;
          color: #475569;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .btn:hover {
          background-color: #e2e8f0;
          color: #0f172a;
        }
      </style>
    </head>
    <body>
      <h2>\uD83D\uDCA1 Bien organiser vos recrutements</h2>
      <p>Pour ne pas mélanger les candidatures et garantir l'efficacité de l'IA, adoptez ce principe simple :</p>
      
      <div class="highlight-box">
        1 Offre = 1 Dossier Drive = 1 Fichier Google Sheet
      </div>
      
      <h3><span class="icon">\uD83D\uDCC1</span> 1. Côté Google Drive</h3>
      <p>Créez un sous-dossier par poste (ex: <i>"Chef de Projet"</i>, <i>"Développeur"</i>). N'y placez <strong>que</strong> les CVs liés à ce poste.</p>
      
      <h3><span class="icon">\uD83D\uDCCA</span> 2. Côté Google Sheets</h3>
      <p>Au lieu de réutiliser ce même fichier pour tous vos recrutements, utilisez la fonction <b>Fichier > Créer une copie</b> pour chaque nouveau poste à pourvoir.<br>
      Dans l'onglet <i>Configuration</i> de la copie, renseignez l'URL du dossier Drive spécifique et l'annonce correspondante.</p>
      
      <hr>
      
      <div class="success-box">
        <div class="icon">\u2705</div>
        <div>
          <strong>Avantages majeurs :</strong><br>
          Aucun mélange de profils, conformité RGPD maîtrisée campagne par campagne, et partage facilité avec les managers métiers.
        </div>
      </div>
      
      <div class="footer-btn">
        <button class="btn" onclick="google.script.host.close()">Fermer le guide</button>
      </div>
    </body>
    </html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(600)
    .setHeight(560);
    
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '\uD83D\uDCD6 Guide d\'utilisation');
}

/**
 * Affiche une fenêtre de dialogue HTML pour enregistrer la clé API Gemini de manière sécurisée
 * dans les propriétés du script Google (PropertiesService) et non dans la feuille.
 */
function showSetApiKeyDialog() {
  const currentKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  const isSet = currentKey.length > 0;
  const maskedKey = isSet ? `${currentKey.substring(0, 6)}${'\u25cf'.repeat(20)}` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', sans-serif;
      padding: 24px;
      color: #334155;
      font-size: 14px;
      margin: 0;
      background-color: #ffffff;
    }
    h2 {
      color: #0f172a;
      margin-top: 0;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .status-banner {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-banner.ok {
      background-color: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
    }
    .status-banner.warn {
      background-color: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }
    .status-banner code {
      background: rgba(255,255,255,0.6);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      letter-spacing: 1px;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 8px;
      color: #1e293b;
      font-size: 13px;
    }
    input[type=text] {
      width: 100%;
      padding: 10px 12px;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      font-family: monospace;
      transition: all 0.2s;
      outline: none;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    input[type=text]:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
    .hint {
      font-size: 12px;
      color: #64748b;
      margin-top: 8px;
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 28px;
    }
    .btn {
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary {
      background-color: #2563eb;
      color: white;
      box-shadow: 0 1px 2px rgba(37, 99, 235, 0.3);
    }
    .btn-primary:hover:not(:disabled) {
      background-color: #1d4ed8;
      box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
    }
    .btn-danger {
      background-color: #fef2f2;
      color: #dc2626;
      border: 1px solid #fecaca;
    }
    .btn-danger:hover {
      background-color: #fee2e2;
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      box-shadow: none;
    }
    #feedback {
      margin-top: 16px;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      display: none;
    }
    #feedback.err {
      background-color: #fef2f2;
      color: #b91c1c;
      border-left: 3px solid #ef4444;
    }
    #feedback.ok {
      background-color: #f0fdf4;
      color: #15803d;
      border-left: 3px solid #22c55e;
    }
  </style>
</head>
<body>
  <h2>\uD83D\uDD11 Sécurité de la clé API</h2>
  <div class="status-banner ${isSet ? 'ok' : 'warn'}">
    ${isSet ? '\u2705' : '\u26a0\ufe0f'}
    <div>
      ${isSet ? `Clé actuellement protégée : <code>${maskedKey}</code>` : 'Aucune clé configurée pour le moment.'}
    </div>
  </div>
  
  <div style="margin-bottom: 20px;">
    <label for="apiKey">Nouvelle clé API (Google AI Studio)</label>
    <input type="text" id="apiKey" placeholder="Collez votre clé commençant par AIza..." autocomplete="off" spellcheck="false" />
    <p class="hint">\uD83D\uDD12 Votre clé est enregistrée de façon chiffrée dans les propriétés système du script. Elle ne sera jamais visible dans les cellules du tableur.</p>
  </div>
  
  <div id="feedback"></div>
  
  <div class="actions">
    <button id="btnSave" class="btn btn-primary" onclick="saveKey()">
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
      Enregistrer la clé
    </button>
    ${isSet ? `
    <button class="btn btn-danger" onclick="clearKey()">
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
      Supprimer
    </button>
    ` : ''}
  </div>

  <script>
    function showFeedback(msg, type) {
      var el = document.getElementById('feedback');
      el.textContent = msg;
      el.className = type;
      el.style.display = 'block';
    }
    function saveKey() {
      var key = document.getElementById('apiKey').value.trim();
      if (!key) { showFeedback('Veuillez saisir une clé API.', 'err'); return; }
      if (key.indexOf('AIza') !== 0 || key.length < 30) {
        showFeedback('Format invalide. Une clé Gemini commence par "AIza".', 'err');
        return;
      }
      var btn = document.getElementById('btnSave');
      btn.disabled = true;
      btn.innerHTML = 'Enregistrement...';
      
      google.script.run
        .withSuccessHandler(function(result) {
          if (result && result.ok) {
            showFeedback('Clé enregistrée avec succès !', 'ok');
            setTimeout(function() { 
              google.script.run.updateApiKeyStatusUI(); 
              google.script.host.close(); 
            }, 1000);
          } else {
            var msg = result ? result.message : 'Erreur inconnue.';
            showFeedback(msg, 'err');
            btn.disabled = false;
            btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Enregistrer la clé';
          }
        })
        .withFailureHandler(function(err) {
          showFeedback('Erreur serveur : ' + err.message, 'err');
          btn.disabled = false;
          btn.innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg> Enregistrer la clé';
        })
        .saveApiKey(key);
    }
    function clearKey() {
      if (!confirm("Supprimer la clé API ? L'outil ne pourra plus analyser de CVs.")) return;
      google.script.run
        .withSuccessHandler(function() { 
          google.script.run.updateApiKeyStatusUI(); 
          google.script.host.close(); 
        })
        .withFailureHandler(function(err) { 
          showFeedback('Erreur : ' + err.message, 'err'); 
        })
        .clearApiKey();
    }
  <\/script>
</body>
</html>`;

  const htmlOutput = HtmlService.createHtmlOutput(html).setWidth(500).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '\uD83D\uDD11 Configuration API');
}

/** Enregistre la clé API Gemini de manière sécurisée dans PropertiesService. Retourne {ok, message}. */
function saveApiKey(key) {
  const trimmedKey = (key || '').trim();
  // La validation est également effectuée côté client ; ceci est une sécurité côté serveur
  if (!trimmedKey || trimmedKey.length < 10) {
    return { ok: false, message: 'Clé vide ou trop courte.' };
  }
  try {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', trimmedKey);
    return { ok: true };
  } catch(e) {
    return { ok: false, message: `Impossible de sauvegarder la clé : ${e.message}` };
  }
}

/** Supprime la clé API enregistrée dans PropertiesService. */
function clearApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_API_KEY');
  SpreadsheetApp.getActiveSpreadsheet().toast('Clé API supprimée.', 'Configuration');
}

/**
 * Lit la feuille des résultats et génère des brouillons d'emails (via l'IA) pour les candidats évalués.
 */
function draftEmailsForCandidates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName("Résultats de l'Analyse");
  
  if (!resultsSheet) {
    SpreadsheetApp.getUi().alert("Erreur : la feuille des résultats est introuvable.");
    return;
  }
  
  const lastRow = resultsSheet.getLastRow();
  if (lastRow < 4) {
    SpreadsheetApp.getUi().alert("Aucun candidat trouvé dans le tableau.");
    return;
  }
  
  // Les données commencent à la ligne 4
  const data = resultsSheet.getRange(4, 1, lastRow - 3, 13).getValues();
  let draftCount = 0;
  
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert("Génération d'emails via l'IA", 
    "Voulez-vous générer un brouillon d'email ultra-personnalisé (rédigé par l'IA) pour chaque candidat du tableau ? (Le processus prend quelques secondes par email). Les emails seront créés dans vos brouillons Gmail.", 
    ui.ButtonSet.YES_NO);
    
  if (response !== ui.Button.YES) return;
  
  ss.toast("Génération des brouillons en cours...", "📧 Emails", 10);
  
  // Récupérer la configuration de l'API pour la rédaction via Gemini
  const configSheet = ss.getSheetByName("Configuration");
  const config = getConfig(configSheet);
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || (config['Clé API Gemini'] || '').toString().trim();
  const model = (config['Modèle Gemini'] || 'gemini-3.5-flash').toString().trim();
  
  if (!apiKey) {
    ui.alert("Veuillez configurer votre clé API Gemini pour générer les textes d'emails.");
    return;
  }

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const candidateName = row[0];
    const email = row[1];
    const strengths = row[6]; // Colonne G (index 6)
    const weaknesses = row[7]; // Colonne H (index 7)
    const recommendation = row[8]; // Colonne I (index 8)
    
    if (!email || email.toLowerCase().includes("non renseigné") || email.toLowerCase().includes("inconnu") || !email.includes("@")) {
      continue; // Ignorer s'il n'y a pas d'adresse email valide
    }
    
    // On ne génère un brouillon que pour "À contacter" ou "À refuser"
    if (recommendation !== "À contacter" && recommendation !== "À refuser") {
      continue;
    }
    
    const isAccepted = recommendation === "À contacter";
    const prompt = `Agis comme un recruteur bienveillant et professionnel.
Rédige un email très court et poli à l'intention de "${candidateName}".
Contexte : Le candidat a postulé à une de nos offres.
Décision : ${isAccepted ? "Nous souhaitons le contacter pour un entretien." : "Nous ne retenons pas sa candidature pour ce poste."}
Ses points forts (à mentionner brièvement s'ils sont pertinents) : ${strengths}
Raisons du refus (si refus) ou points à creuser (si accepté) : ${weaknesses}
Rédige uniquement le corps de l'email (pas d'objet, pas de placeholders pour ma signature). Commence directement par 'Bonjour ${candidateName.split(' ')[0] || candidateName},'`;

    let emailBody = "";
    try {
      const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 }
      };
      
      const responseText = callGeminiAPI(model, payload, apiKey);
      const json = JSON.parse(responseText);
      if (json.candidates && json.candidates[0]) {
        emailBody = json.candidates[0].content.parts[0].text;
      }
    } catch(e) {
      Logger.log("Erreur lors de la génération de l'email pour " + candidateName + ": " + e.message);
      continue;
    }
    
    if (emailBody) {
      const subject = isAccepted ? `Suite à votre candidature - Échange téléphonique` : `Suite à votre candidature`;
      GmailApp.createDraft(email, subject, emailBody);
      draftCount++;
    }
  }
  
  ui.alert(`Génération terminée : ${draftCount} brouillon(s) créé(s) dans votre boîte Gmail.`);
}
