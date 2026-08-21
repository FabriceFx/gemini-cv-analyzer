/**
 * UI.gs
 * Interface utilisateur : menus, création des onglets, modals.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    ui.createMenu(t('menuTitle'))
      .addItem(t('menuSidebar'), 'showSidebar')
      .addSeparator()
      .addItem(t('menuInit'), 'setupSheets')
      .addItem(t('menuConfig'), 'showSetApiKeyDialog')
      .addSeparator()
      .addItem(t('menuAnalyzeAll'), 'analyzeCVs')
      .addItem(t('menuAnalyzeSingle'), 'analyzeSingleCV')
      .addItem(t('menuDailyTrigger'), 'toggleDailyTrigger')
      .addSeparator()
      .addItem(t('menuDraftEmails'), 'draftEmailsForCandidates')
      .addSeparator()
      .addItem(t('menuPurge'), 'purgeOldCVs')
      .addSeparator()
      .addItem(t('menuClear'), 'clearResults')
      .addSeparator()
      .addItem(t('menuGuide'), 'showGuide')
      .addItem(t('menuAbout'), 'showAboutDialog')
      .addToUi();
  } catch (e) {
    Logger.log("Erreur lors de la création du menu: " + e.message);
  }
}

/**
 * Initialise et met en forme les 2 onglets du classeur ("Résultats de l'analyse" et "Journal RGPD").
 * Supprime proprement l'ancienne feuille "Configuration" après avoir migré ses réglages vers DocumentProperties.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // Confirmation explicite avant réinitialisation
  const confirm = ui.alert(
    "⚠️ Attention : Réinitialisation des feuilles",
    "Cette action va réinitialiser les onglets 'Résultats de l'analyse' et 'Journal RGPD'.\n(Vos paramètres restent conservés en mémoire dans le classeur).\n\nSouhaitez-vous continuer ?",
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const primaryColor = "#1e40af"; // Blue 800
  const borderGrey = "#e2e8f0";   // Slate 200
  const textDark = "#0f172a";     // Slate 900
  const textMuted = "#64748b";    // Slate 500

  // === 1. Migration et suppression de l'ancienne feuille Configuration si présente ===
  const legacyConfigSheet = ss.getSheetByName(LEGACY_CONFIG_SHEET_NAME);
  if (legacyConfigSheet) {
    _migrateLegacyConfigSheet(PropertiesService.getDocumentProperties());
    if (ss.getSheets().length > 1) {
      ss.deleteSheet(legacyConfigSheet);
    }
  }

  // === 2. Feuille des résultats ===
  let resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!resultsSheet) {
    resultsSheet = ss.insertSheet(RESULTS_SHEET_NAME, 0);
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
  resultsSheet.setColumnWidth(3, 130);
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
  resultsSheet.getRange("B4:B").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontSize(10).setFontColor(textDark);
  // Format texte obligatoire pour la colonne C (Téléphone) afin de préserver le zéro initial
  resultsSheet.getRange("C4:C").setNumberFormat("@").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontSize(10).setFontColor(textDark);
  resultsSheet.getRange("D4:H").setVerticalAlignment("top").setWrap(true).setFontFamily("Inter").setFontSize(10).setFontColor(textDark);
  resultsSheet.getRange("I4:J").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontWeight("bold").setFontFamily("Inter");
  resultsSheet.getRange("K4:L").setHorizontalAlignment("center").setVerticalAlignment("middle").setFontFamily("Inter").setFontColor(textMuted);

  const recommendationRange = resultsSheet.getRange("I4:I");
  const ruleGreen = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("À contacter").setBackground("#dcfce7").setFontColor("#166534").setRanges([recommendationRange]).build();
  const ruleYellow = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("À garder en vivier").setBackground("#fef9c3").setFontColor("#854d0e").setRanges([recommendationRange]).build();
  const ruleRed = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("À refuser").setBackground("#fee2e2").setFontColor("#991b1b").setRanges([recommendationRange]).build();
  const ruleError = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Erreur").setBackground("#fef2f2").setFontColor("#dc2626").setRanges([recommendationRange]).build();

  const noteRange = resultsSheet.getRange("J4:J");
  const ruleNoteGreen = SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(4).setBackground("#dcfce7").setFontColor("#166534").setRanges([noteRange]).build();
  const ruleNoteYellow = SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(3).setBackground("#fef9c3").setFontColor("#854d0e").setRanges([noteRange]).build();
  const ruleNoteRed = SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(1, 2).setBackground("#fee2e2").setFontColor("#991b1b").setRanges([noteRange]).build();

  const rules = resultsSheet.getConditionalFormatRules();
  rules.push(ruleGreen, ruleYellow, ruleRed, ruleError, ruleNoteGreen, ruleNoteYellow, ruleNoteRed);
  resultsSheet.setConditionalFormatRules(rules);

  ss.setActiveSheet(resultsSheet);
  ss.toast("Classeur initialisé avec succès (2 onglets : Résultats & Journal RGPD).", "✅ Initialisation réussie");
}

function updateApiKeyStatusUI() {
  // Fonction conservée pour rétrocompatibilité d'appels de dialogs
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
        .warn-box { background-color: #fffbeb; border: 1px solid #fde68a; padding: 16px; border-radius: 6px; font-size: 13.5px; color: #92400e; display: flex; gap: 12px; align-items: flex-start; margin-bottom: 20px; }
        .icon { font-size: 18px; }
        hr { border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0; }
        .footer-btn { margin-top: 24px; text-align: right; }
        .btn { background-color: #f1f5f9; color: #475569; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; cursor: pointer; transition: all 0.2s; }
        .btn:hover { background-color: #e2e8f0; color: #0f172a; }
      </style>
    </head>
    <body>
      <h2>💡 Bien organiser vos recrutements</h2>
      <p>Pour ne pas mélanger les candidatures et garantir l'efficacité de l'IA, adoptez ce principe simple :</p>
      
      <div class="highlight-box">
        1 Offre = 1 Dossier Drive = 1 Fichier Google Sheet
      </div>
      
      <h3><span class="icon">📁</span> 1. Scraping vs Copier-Coller</h3>
      <p>Les sites modernes (LinkedIn, Welcome To The Jungle) utilisent du JavaScript qui bloque souvent l'analyse automatique. <b>Pour des résultats optimaux, copiez-collez le texte de l'annonce manuellement dans la cellule "URL ou texte de l'annonce".</b></p>
      
      <h3><span class="icon">🛡️</span> 2. Confidentialité & RGPD (Gratuit vs Payant)</h3>
      <div class="warn-box">
        <div class="icon">⚠️</div>
        <div>
          <strong>Politique de données Google API :</strong> En palier gratuit, Google se réserve le droit d'utiliser les requêtes pour l'entraînement. <b>Pour un usage professionnel conforme RGPD, activez le mode Payant (Pay-as-you-go)</b> dans Google AI Studio afin de garantir la non-conservation et la confidentialité stricte des CVs.
        </div>
      </div>
      <p>Configurez le délai de rétention dans les paramètres. La fonction de nettoyage RGPD met à la corbeille les documents expirés et pseudonymise les colonnes d'identification (Nom, Email, Téléphone).</p>
      
      <h3><span class="icon">🎯</span> 3. Prise de contact & Supervision humaine</h3>
      <p>Le système sélectionne automatiquement les <b>10 meilleurs CVs qualifiés (note ≥ 4/5)</b> pour la prise de contact. Les emails sont créés en <b>brouillons Gmail</b> : relisez-les systématiquement avant envoi pour prévenir toute tentative d'injection de prompt.</p>
      
      <hr>
      
      <div class="success-box">
        <div class="icon">✅</div>
        <div>
          <strong>Avantages majeurs :</strong><br>
          Aucun mélange de profils, conformité RGPD maîtrisée campagne par campagne, supervision humaine intégrale et partage facilité avec les managers métiers.
        </div>
      </div>
      
      <div class="footer-btn">
        <button class="btn" onclick="google.script.host.close()">Fermer le guide</button>
      </div>
    </body>
    </html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent).setWidth(600).setHeight(580);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '📖 Guide d\'utilisation');
}

function showSetApiKeyDialog() {
  const currentKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
  const isSet = currentKey.length > 0;
  const maskedKey = isSet ? `${currentKey.substring(0, 6)}${'●'.repeat(20)}` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; padding: 24px; color: #334155; font-size: 14px; margin: 0; background-color: #ffffff; }
    h2 { color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 600; margin-bottom: 20px; }
    .status-banner { padding: 12px 16px; border-radius: 8px; margin-bottom: 24px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
    .status-banner.ok { background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
    .status-banner.warn { background-color: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    .status-banner code { background: rgba(255,255,255,0.6); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; letter-spacing: 1px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; color: #1e293b; font-size: 13px; }
    input[type=password] { width: 100%; padding: 10px 12px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-family: monospace; transition: all 0.2s; outline: none; }
    input[type=password]:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }
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
  <h2>🔑 Sécurité de la clé API</h2>
  <div class="status-banner ${isSet ? 'ok' : 'warn'}">
    ${isSet ? '✅' : '⚠️'}
    <div>${isSet ? `Clé actuellement protégée : <code>${maskedKey}</code>` : 'Aucune clé configurée pour le moment.'}</div>
  </div>
  <div style="margin-bottom: 20px;">
    <label for="apiKey">Nouvelle clé API</label>
    <input type="password" id="apiKey" placeholder="Collez votre clé commençant par AIza..." autocomplete="off" spellcheck="false" />
    <p class="hint">🔒 Votre clé est enregistrée dans les propriétés sécurisées du script (Script Properties).</p>
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
  </script>
</body>
</html>`;

  const htmlOutput = HtmlService.createHtmlOutput(html).setWidth(500).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '🔑 Configuration API');
}

function showAboutDialog() {
  const userLocale = Session.getActiveUserLocale() || 'fr';
  const isEn = userLocale.startsWith('en');
  
  const title = isEn ? "About CV Analyzer" : "À propos de l'Analyseur de CV";
  const content = isEn ? 
    "This tool automates CV analysis using Google's Gemini AI, helping you efficiently evaluate candidates against job requirements while remaining GDPR compliant." :
    "Cet outil automatise l'analyse de CV à l'aide de l'IA Gemini de Google, vous aidant à évaluer efficacement les candidats par rapport aux offres d'emploi tout en restant conforme au RGPD.";
  
  const devTitle = isEn ? "Developer" : "Développeur";
  const closeBtn = isEn ? "Close" : "Fermer";

  const html = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; padding: 24px; color: #334155; font-size: 14px; margin: 0; background-color: #ffffff; text-align: center; }
    h2 { color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 600; margin-bottom: 16px; }
    p { line-height: 1.6; margin-bottom: 24px; }
    .dev-info { background-color: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 24px; }
    .dev-info strong { color: #0f172a; }
    a { color: #2563eb; text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .btn { background-color: #f1f5f9; color: #475569; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; cursor: pointer; transition: all 0.2s; }
    .btn:hover { background-color: #e2e8f0; color: #0f172a; }
  </style>
</head>
<body>
  <h2>ℹ️ ${title}</h2>
  <p>${content}</p>
  <div class="dev-info">
    <strong>${devTitle} :</strong> Fabrice Faucheux<br><br>
    <a href="https://faucheux.bzh" target="_blank">https://faucheux.bzh</a>
  </div>
  <button class="btn" onclick="google.script.host.close()">${closeBtn}</button>
</body>
</html>`;

  const htmlOutput = HtmlService.createHtmlOutput(html).setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, title);
}
