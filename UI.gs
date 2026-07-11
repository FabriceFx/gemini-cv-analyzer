/**
 * UI.gs
 * Interface utilisateur : menus, création des onglets, modals.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Analyseur de CV')
    .addItem('⚙️ Initialiser / Réinitialiser les feuilles', 'setupSheets')
    .addItem('🔑 Configurer la clé API', 'showSetApiKeyDialog')
    .addSeparator()
    .addItem('🔍 Analyser les nouveaux CVs (Dossier complet)', 'analyzeCVs')
    .addItem('📄 Analyser un seul CV (Test rapide)', 'analyzeSingleCV')
    .addItem('⏰ Activer/Désactiver l\'analyse quotidienne', 'toggleDailyTrigger')
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
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // === 1. Feuille de configuration ===
  let configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  let existingConfig = {};
  if (!configSheet) {
    configSheet = ss.insertSheet(CONFIG_SHEET_NAME);
  } else {
    try {
      existingConfig = getConfig(configSheet);
    } catch (e) { }

    configSheet.clear();
    configSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  }

  configSheet.setHiddenGridlines(true);

  const primaryColor = "#1e40af"; // Blue 800
  const bgLight = "#f8fafc";      // Slate 50
  const borderGrey = "#e2e8f0";   // Slate 200
  const textDark = "#0f172a";     // Slate 900
  const textMuted = "#64748b";    // Slate 500

  configSheet.getRange("A1:C1").merge().setValue("⚙️ Configuration - Analyseur de CV AI")
    .setFontFamily("Inter")
    .setFontSize(14)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackgroundColor(primaryColor)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  configSheet.setRowHeight(1, 50);

  const storedKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const apiKeyStatus = storedKey ? '✅ Clé configurée en sécurité (menu → Configurer la clé API)' : '⚠️ Non configurée — utilisez le menu → Configurer la clé API';

  const configData = [
    ["Clé API Gemini", apiKeyStatus, "La clé est stockée de façon sécurisée (hors de cette feuille). Utilisez le menu '🔑 Configurer la clé API' pour la modifier."],
    ["URL du dossier Drive contenant les CVs", existingConfig['URL du dossier Drive contenant les CVs'] !== undefined ? existingConfig['URL du dossier Drive contenant les CVs'] : "", "Lien du dossier Google Drive contenant les CVs PDF/DOCX"],
    ["URL ou texte de l'annonce", existingConfig["URL ou texte de l'annonce"] !== undefined ? existingConfig["URL ou texte de l'annonce"] : "", "Entrez l'URL de l'offre d'emploi ou collez directement la description textuelle"],
    ["Modèle Gemini", existingConfig['Modèle Gemini'] || "gemini-3.5-flash", "Sélectionnez le modèle d'IA (gemini-3.5-flash est recommandé)"],
    ["Type de compte Gemini", existingConfig['Type de compte Gemini'] || "Gratuit (Free tier)", "Passez en mode 'Payant' pour analyser beaucoup plus vite (vérifiez votre palier RPM dans Google AI Studio)"],
    ["Critères spécifiques du recruteur", existingConfig['Critères spécifiques du recruteur'] !== undefined ? existingConfig['Critères spécifiques du recruteur'] : "", "Ex: 'Priorité aux compétences React, être bilingue anglais' (optionnel)"],
    ["Prompt système", existingConfig['Prompt système'] || DEFAULT_PROMPT, "Le prompt système utilisé pour l'analyse. Laissez {{JOB_DESCRIPTION}} et {{CRITERIA}} intacts."],
    ["Délai de rétention RGPD (jours)", existingConfig['Délai de rétention RGPD (jours)'] !== undefined ? existingConfig['Délai de rétention RGPD (jours)'] : 730, "Les CV plus anciens seront supprimés et anonymisés (Ex: 730 pour 2 ans)"]
  ];

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

  configSheet.setRowHeight(8, 70);
  configSheet.setRowHeight(9, 140);

  const inputCells = configSheet.getRange("B3:B10");
  inputCells.setWrap(true).setFontSize(11);

  const modelCell = configSheet.getRange("B6");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(AVAILABLE_MODELS, true)
    .setAllowInvalid(true)
    .build();
  modelCell.setDataValidation(rule);

  const accountTypeCell = configSheet.getRange("B7");
  const ruleAccount = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Gratuit (Free tier)", "Payant (Pay-as-you-go)"], true)
    .setAllowInvalid(true)
    .build();
  accountTypeCell.setDataValidation(ruleAccount);

  const apiStatusCell = configSheet.getRange("B3");
  const rulesConfig = configSheet.getConditionalFormatRules();
  rulesConfig.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("✅").setBackground("#dcfce7").setFontColor("#166534").setRanges([apiStatusCell]).build());
  rulesConfig.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("⚠️").setBackground("#fff7ed").setFontColor("#ea580c").setRanges([apiStatusCell]).build());
  configSheet.setConditionalFormatRules(rulesConfig);

  try {
    const protection = configSheet.protect().setDescription("Protection interface config");
    protection.setWarningOnly(false);
    protection.setUnprotectedRanges([inputCells]);
  } catch (e) { }

  configSheet.setColumnWidth(1, 280);
  configSheet.setColumnWidth(2, 500);
  configSheet.setColumnWidth(3, 350);

  // === 2. Feuille des résultats ===
  let resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!resultsSheet) {
    resultsSheet = ss.insertSheet(RESULTS_SHEET_NAME);
  } else {
    resultsSheet.clear();
    resultsSheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
    resultsSheet.getBandings().forEach(b => b.remove());
  }

  resultsSheet.setHiddenGridlines(true);

  resultsSheet.getRange("A1:M1").merge().setValue("Analyse des CVs")
    .setFontFamily("Inter").setFontSize(14).setFontWeight("bold").setFontColor("#ffffff")
    .setBackgroundColor(primaryColor).setHorizontalAlignment("center").setVerticalAlignment("middle");
  resultsSheet.setRowHeight(1, 50);

  resultsSheet.getRange("A2:M2").merge().setValue("Synthèse globale : En attente du lancement de l'analyse pour générer les conseils de session...")
    .setFontFamily("Inter").setFontSize(11).setFontStyle("italic").setFontColor("#475569")
    .setBackgroundColor("#f1f5f9").setVerticalAlignment("middle").setWrap(true)
    .setBorder(false, false, true, false, false, false, borderGrey, SpreadsheetApp.BorderStyle.SOLID);
  resultsSheet.setRowHeight(2, 55);

  const headers = ["Candidat", "Email", "Téléphone", "Expérience pertinente", "Formation & diplômes", "Top 3 compétences", "Points forts", "Points de vigilance / questions", "Recommandation", "Note / 5", "Fichier CV", "Date d'analyse", "ID fichier"];

  const headerRange = resultsSheet.getRange(3, 1, 1, headers.length);
  headerRange.setValues([headers])
    .setFontFamily("Inter").setFontSize(11).setFontWeight("bold").setFontColor("#ffffff")
    .setBackgroundColor("#0f172a").setHorizontalAlignment("center").setVerticalAlignment("middle");

  resultsSheet.setRowHeight(3, 40);
  resultsSheet.setFrozenRows(3);

  try {
    const headerProtection = resultsSheet.getRange("A1:M3").protect().setDescription("Protection en-têtes résultats");
    headerProtection.setWarningOnly(true);
  } catch (e) { }

  resultsSheet.setColumnWidth(1, 150);
  resultsSheet.setColumnWidth(2, 180);
  resultsSheet.setColumnWidth(3, 120);
  resultsSheet.setColumnWidth(4, 220);
  resultsSheet.setColumnWidth(5, 200);
  resultsSheet.setColumnWidth(6, 220);
  resultsSheet.setColumnWidth(7, 280);
  resultsSheet.setColumnWidth(8, 280);
  resultsSheet.setColumnWidth(9, 160);
  resultsSheet.setColumnWidth(10, 90);
  resultsSheet.setColumnWidth(11, 180);
  resultsSheet.setColumnWidth(12, 140);
  resultsSheet.setColumnWidth(13, 120);
  resultsSheet.hideColumns(13);

  resultsSheet.getRange("A3:M1000").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);

  resultsSheet.getRange("A4:A").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontWeight("bold").setFontColor(primaryColor);
  resultsSheet.getRange("B4:H").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontSize(10).setFontColor(textDark);
  resultsSheet.getRange("I4:J").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontWeight("bold").setFontFamily("Inter");
  resultsSheet.getRange("K4:L").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontFamily("Inter").setFontColor(textMuted);

  const recommendationRange = resultsSheet.getRange("I4:I");
  const ruleGreen = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("À contacter").setBackground("#dcfce7").setFontColor("#166534").setRanges([recommendationRange]).build();
  const ruleYellow = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("À garder en vivier").setBackground("#fef9c3").setFontColor("#854d0e").setRanges([recommendationRange]).build();
  const ruleRed = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("À refuser").setBackground("#fee2e2").setFontColor("#991b1b").setRanges([recommendationRange]).build();

  const noteRange = resultsSheet.getRange("J4:J");
  const ruleNoteGreen = SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(4).setBackground("#dcfce7").setFontColor("#166534").setRanges([noteRange]).build();
  const ruleNoteYellow = SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(3).setBackground("#fef9c3").setFontColor("#854d0e").setRanges([noteRange]).build();
  const ruleNoteRed = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThanOrEqualTo(2).setBackground("#fee2e2").setFontColor("#991b1b").setRanges([noteRange]).build();

  const rules = resultsSheet.getConditionalFormatRules();
  rules.push(ruleGreen, ruleYellow, ruleRed, ruleNoteGreen, ruleNoteYellow, ruleNoteRed);
  resultsSheet.setConditionalFormatRules(rules);

  // Supprimer les autres feuilles éventuelles
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sheetName = sheets[i].getName();
    if (sheetName !== CONFIG_SHEET_NAME && sheetName !== RESULTS_SHEET_NAME && sheetName !== RGPD_LOG_SHEET_NAME) {
      ss.deleteSheet(sheets[i]);
    }
  }

  ss.toast("Feuilles configurées avec succès.", "✅ Initialisation réussie");
}

function updateApiKeyStatusUI() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) return;

  const storedKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const apiKeyStatus = storedKey ? '✅ Clé configurée en sécurité (menu → Configurer la clé API)' : '⚠️ Non configurée — utilisez le menu → Configurer la clé API';
  configSheet.getRange("B3").setValue(apiKeyStatus);
}

function showGuide() {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <base target="_top">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Inter', sans-serif; padding: 24px; color: #334155; font-size: 14px; line-height: 1.6; margin: 0; background-color: #ffffff; }
        h2 { color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 700; border-bottom: 2px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 20px; }
        h3 { color: #1e40af; font-size: 15px; font-weight: 600; margin-top: 24px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
        p { margin-top: 0; margin-bottom: 16px; }
        .highlight-box { background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 6px; font-weight: 600; font-size: 15px; color: #0f172a; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .success-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 6px; font-size: 13.5px; color: #166534; display: flex; gap: 12px; align-items: flex-start; }
        .icon { font-size: 18px; }
        hr { border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0; }
        .footer-btn { margin-top: 24px; text-align: right; }
        .btn { background-color: #f1f5f9; color: #475569; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; cursor: pointer; transition: all 0.2s; }
        .btn:hover { background-color: #e2e8f0; color: #0f172a; }
      </style>
    </head>
    <body>
      <h2>\uD83D\uDCA1 Bien organiser vos recrutements</h2>
      <p>Pour ne pas mélanger les candidatures et garantir l'efficacité de l'IA, adoptez ce principe simple :</p>
      
      <div class="highlight-box">
        1 Offre = 1 Dossier Drive = 1 Fichier Google Sheet
      </div>
      
      <h3><span class="icon">\uD83D\uDCC1</span> 1. Scraping vs Copier-Coller</h3>
      <p>Les sites modernes (LinkedIn, Welcome To The Jungle) utilisent du JavaScript qui bloque souvent l'analyse automatique. <b>Pour des résultats optimaux, copiez-collez le texte de l'annonce manuellement dans la cellule "URL ou texte de l'annonce".</b></p>
      
      <h3><span class="icon">\uD83D\uDEE1\uFE0F</span> 2. Conformité RGPD</h3>
      <p>Configurez le délai de rétention dans les paramètres. Lancez la purge régulièrement : les CVs expirés seront placés dans votre corbeille Drive et leurs données d'identification (Nom, Email, Téléphone) seront <b>anonymisées</b> dans le tableur pour garder vos statistiques.</p>
      
      <h3><span class="icon">\uD83D\uDE80</span> 3. Vitesse et Type de compte</h3>
      <p>Par défaut, le script analyse 3 CVs toutes les 12s pour respecter le mode "Gratuit". Si vous passez votre projet Google AI Studio en mode payant (Pay-as-you-go), changez le réglage sur <b>Payant</b> pour traiter vos documents par lots de 15.</p>
      
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

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent).setWidth(600).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '\uD83D\uDCD6 Guide d\'utilisation');
}

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
    /* Same styles as original */
    body { font-family: 'Inter', sans-serif; padding: 24px; color: #334155; font-size: 14px; margin: 0; background-color: #ffffff; }
    h2 { color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 600; margin-bottom: 20px; }
    .status-banner { padding: 12px 16px; border-radius: 8px; margin-bottom: 24px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
    .status-banner.ok { background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
    .status-banner.warn { background-color: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    .status-banner code { background: rgba(255,255,255,0.6); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; letter-spacing: 1px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; color: #1e293b; font-size: 13px; }
    input[type=text] { width: 100%; padding: 10px 12px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-family: monospace; transition: all 0.2s; outline: none; }
    input[type=text]:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }
    .hint { font-size: 12px; color: #64748b; margin-top: 8px; line-height: 1.5; }
    .actions { display: flex; gap: 12px; margin-top: 28px; }
    .btn { padding: 10px 16px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; gap: 6px; }
    .btn-primary { background-color: #2563eb; color: white; box-shadow: 0 1px 2px rgba(37, 99, 235, 0.3); }
    .btn-primary:hover:not(:disabled) { background-color: #1d4ed8; }
    .btn-danger { background-color: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
    .btn-danger:hover { background-color: #fee2e2; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    #feedback { margin-top: 16px; padding: 10px 14px; border-radius: 6px; font-size: 13px; display: none; }
    #feedback.err { background-color: #fef2f2; color: #b91c1c; border-left: 3px solid #ef4444; }
    #feedback.ok { background-color: #f0fdf4; color: #15803d; border-left: 3px solid #22c55e; }
  </style>
</head>
<body>
  <h2>\uD83D\uDD11 Sécurité de la clé API</h2>
  <div class="status-banner ${isSet ? 'ok' : 'warn'}">
    ${isSet ? '\u2705' : '\u26a0\ufe0f'}
    <div>${isSet ? `Clé actuellement protégée : <code>${maskedKey}</code>` : 'Aucune clé configurée pour le moment.'}</div>
  </div>
  <div style="margin-bottom: 20px;">
    <label for="apiKey">Nouvelle clé API</label>
    <input type="text" id="apiKey" placeholder="Collez votre clé commençant par AIza..." autocomplete="off" spellcheck="false" />
    <p class="hint">\uD83D\uDD12 Votre clé est enregistrée de façon chiffrée dans les propriétés système du script.</p>
  </div>
  <div id="feedback"></div>
  <div class="actions">
    <button id="btnSave" class="btn btn-primary" onclick="saveKey()">Enregistrer la clé</button>
    ${isSet ? `<button class="btn btn-danger" onclick="clearKey()">Supprimer</button>` : ''}
  </div>
  <script>
    function showFeedback(msg, type) { var el = document.getElementById('feedback'); el.textContent = msg; el.className = type; el.style.display = 'block'; }
    function saveKey() {
      var key = document.getElementById('apiKey').value.trim();
      if (!key) { showFeedback('Veuillez saisir une clé API.', 'err'); return; }
      var btn = document.getElementById('btnSave'); btn.disabled = true; btn.innerHTML = 'Enregistrement...';
      google.script.run.withSuccessHandler(function(result) {
        if (result && result.ok) {
          showFeedback('Clé enregistrée avec succès !', 'ok');
          setTimeout(function() { google.script.run.updateApiKeyStatusUI(); google.script.host.close(); }, 1000);
        } else {
          showFeedback(result ? result.message : 'Erreur inconnue.', 'err');
          btn.disabled = false; btn.innerHTML = 'Enregistrer la clé';
        }
      }).saveApiKey(key);
    }
    function clearKey() {
      if (!confirm("Supprimer la clé API ?")) return;
      google.script.run.withSuccessHandler(function() { google.script.run.updateApiKeyStatusUI(); google.script.host.close(); }).clearApiKey();
    }
  <\/script>
</body>
</html>`;

  const htmlOutput = HtmlService.createHtmlOutput(html).setWidth(500).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '\uD83D\uDD11 Configuration API');
}
