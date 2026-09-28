/**
 * UI.gs
 * Interface utilisateur : menus, création des onglets, modales.
 */

function onOpen() {
  // Déclencheur simple, 30 secondes au plus : il ne fait que construire le menu.
  try {
    SpreadsheetApp.getUi().createMenu(traduire_('menuTitle'))
      .addItem(traduire_('menuSidebar'), 'showSidebar')
      .addSeparator()
      .addItem(traduire_('menuInit'), 'setupSheets')
      .addItem(traduire_('menuConfig'), 'showSetApiKeyDialog')
      .addSeparator()
      .addItem(traduire_('menuProposeGrid'), 'proposerGrilleEvaluation')
      .addItem(traduire_('menuGrid'), 'ouvrirGrilleEvaluation')
      .addSeparator()
      .addItem(traduire_('menuAnalyzeAll'), 'analyzeCVs')
      .addItem(traduire_('menuAnalyzeSingle'), 'analyzeSingleCV')
      .addItem(traduire_('menuRerank'), 'recalculerClassement')
      .addItem(traduire_('menuDailyTrigger'), 'toggleDailyTrigger')
      .addSeparator()
      .addItem(traduire_('menuDraftEmails'), 'draftEmailsForCandidates')
      .addSeparator()
      .addItem(traduire_('menuPurge'), 'purgeOldCVs')
      .addItem(traduire_('menuClear'), 'clearResults')
      .addSeparator()
      .addItem(traduire_('menuGuide'), 'showGuide')
      .addItem(traduire_('menuAbout'), 'showAboutDialog')
      .addToUi();
  } catch (e) {
    Logger.log(`Erreur lors de la création du menu : ${e.message}`);
  }
}

/**
 * Largeur de chaque colonne d'un onglet Résultats neuf.
 *
 * Construite à l'appel, comme les notes ci-dessous : COLONNES_RESULTATS vit
 * dans Constants.gs, et une constante globale qui lirait une constante d'un
 * autre fichier ferait échouer le chargement selon l'ordre des fichiers.
 */
const largeursColonnesResultats_ = () => ({
  [COLONNES_RESULTATS.CANDIDAT]: 150,
  [COLONNES_RESULTATS.EMAIL]: 180,
  [COLONNES_RESULTATS.TELEPHONE]: 120,
  [COLONNES_RESULTATS.RECOMMANDATION]: 140,
  [COLONNES_RESULTATS.SCORE]: 80,
  [COLONNES_RESULTATS.MOTIF]: 260,
  [COLONNES_RESULTATS.DECISION]: 140,
  [COLONNES_RESULTATS.DOUBLON]: 200,
  [COLONNES_RESULTATS.DETAIL]: 360,
  [COLONNES_RESULTATS.POINTS_FORTS]: 260,
  [COLONNES_RESULTATS.VIGILANCE]: 260,
  [COLONNES_RESULTATS.EXPERIENCE]: 220,
  [COLONNES_RESULTATS.FORMATION]: 200,
  [COLONNES_RESULTATS.FICHIER]: 170,
  [COLONNES_RESULTATS.DATE]: 130,
  [COLONNES_RESULTATS.BROUILLON]: 130,
});

/** Ce que chaque colonne veut dire, là où on la lit : en note sur l'en-tête. */
const notesEnteteResultats_ = () => ({
  [COLONNES_RESULTATS.RECOMMANDATION]: "Proposition de l'outil, recalculée à chaque classement :\nÀ contacter : score ≥ seuil de contact et indispensables démontrés, dans la limite des places ;\nÀ garder en vivier : sous le seuil de contact, au-delà des places, ou indispensable à vérifier ;\nÀ refuser : score sous le seuil de vivier ;\nDoublon : autre CV de la même personne ;\nÀ réanalyser : évalué avec une autre annonce ou une autre grille.",
  [COLONNES_RESULTATS.SCORE]: 'Moyenne pondérée des critères de la grille : Satisfait = 1, Partiel = 0,5, Non démontré = 0. Le calcul figure dans « Détail du score ». Vide : non mesuré (erreur ou CV à réanalyser).',
  [COLONNES_RESULTATS.MOTIF]: 'Pourquoi cette recommandation : seuil atteint ou non, indispensable manquant, rang au-delà des places, doublon.',
  [COLONNES_RESULTATS.DECISION]: "Votre décision. Le code ne l'écrit jamais. Elle prime sur la recommandation pour les brouillons d'email ; tout autre texte que les trois décisions veut dire « je m'en occupe » et ne génère pas de brouillon.",
  [COLONNES_RESULTATS.DOUBLON]: "Même email ou même téléphone : c'est la même personne, une seule fiche est classée (la mieux notée).\n« À vérifier » : présomption (même nom, ou coordonnées partagées par des noms différents), sans effet sur le classement.",
  [COLONNES_RESULTATS.DETAIL]: "Un critère par ligne : ✔ satisfait, ◐ partiel, ✘ non démontré, avec son niveau, son poids et l'extrait du CV qui le justifie. Puis le calcul du score.",
  [COLONNES_RESULTATS.BROUILLON]: "Date du brouillon Gmail créé pour ce candidat. Tant qu'elle est là, aucun autre brouillon n'est créé : effacez-la pour en obtenir un nouveau.",
});

/**
 * Initialise et met en forme l'onglet « Résultats de l'analyse », et pose la
 * grille d'évaluation si elle manque. La grille existante et le journal RGPD
 * ne sont pas touchés.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    '⚠️ Attention : réinitialisation des résultats',
    "Cette action efface toutes les lignes de l'onglet « Résultats de l'analyse », décisions RH comprises, et recrée ses colonnes.\n\nLa grille d'évaluation, le journal RGPD et vos réglages sont conservés.\n\nSouhaitez-vous continuer ?",
    ui.ButtonSet.YES_NO,
  );
  if (confirm !== ui.Button.YES) return;

  const primaryColor = '#1e40af'; // Blue 800
  const borderGrey = '#e2e8f0'; // Slate 200
  const textDark = '#0f172a'; // Slate 900
  const textMuted = '#64748b'; // Slate 500

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
    resultsSheet.clearConditionalFormatRules();
    resultsSheet.getRange(1, 1, resultsSheet.getMaxRows(), resultsSheet.getMaxColumns()).clearDataValidations();
    resultsSheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach((p) => p.remove());
    resultsSheet.getBandings().forEach((b) => b.remove());
    resultsSheet.showColumns(1, resultsSheet.getMaxColumns());
  }

  const entetes = ORDRE_COLONNES_RESULTATS;
  const largeur = entetes.length;
  if (resultsSheet.getMaxColumns() < largeur) {
    resultsSheet.insertColumnsAfter(resultsSheet.getMaxColumns(), largeur - resultsSheet.getMaxColumns());
  }

  resultsSheet.setHiddenGridlines(true);

  resultsSheet.getRange(1, 1, 1, largeur).merge().setValue('Analyse des CV')
    .setFontFamily('Inter').setFontSize(14).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground(primaryColor).setHorizontalAlignment('center').setVerticalAlignment('middle');
  resultsSheet.setRowHeight(1, 50);

  resultsSheet.getRange(2, 1, 1, largeur).merge().setValue("Synthèse globale : en attente du lancement de l'analyse...")
    .setFontFamily('Inter').setFontSize(11).setFontStyle('italic').setFontColor('#475569')
    .setBackground('#f1f5f9').setVerticalAlignment('middle').setWrap(true)
    .setBorder(false, false, true, false, false, false, borderGrey, SpreadsheetApp.BorderStyle.SOLID);
  resultsSheet.setRowHeight(2, 55);

  const headerRange = resultsSheet.getRange(LIGNE_ENTETE_RESULTATS, 1, 1, largeur);
  headerRange.setValues([entetes])
    .setFontFamily('Inter').setFontSize(11).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#0f172a').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  const notes = notesEnteteResultats_();
  headerRange.setNotes([entetes.map((nom) => notes[nom] || '')]);

  resultsSheet.setRowHeight(LIGNE_ENTETE_RESULTATS, 40);
  resultsSheet.setFrozenRows(LIGNE_ENTETE_RESULTATS);

  try {
    resultsSheet.getRange(1, 1, LIGNE_ENTETE_RESULTATS, largeur).protect()
      .setDescription('Protection en-têtes résultats').setWarningOnly(true);
  } catch (e) { }

  const carte = {};
  entetes.forEach((nom, i) => { carte[nom] = i; });
  const largeurs = largeursColonnesResultats_();
  entetes.forEach((nom, i) => {
    if (largeurs[nom]) resultsSheet.setColumnWidth(i + 1, largeurs[nom]);
  });

  const donnees = resultsSheet.getRange(PREMIERE_LIGNE_RESULTATS, 1, resultsSheet.getMaxRows() - LIGNE_ENTETE_RESULTATS, largeur);
  donnees.setVerticalAlignment('top').setWrap(true).setFontFamily('Inter').setFontSize(10).setFontColor(textDark);
  resultsSheet.getRange(LIGNE_ENTETE_RESULTATS, 1, resultsSheet.getMaxRows() - LIGNE_ENTETE_RESULTATS + 1, largeur)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  plageColonne_(resultsSheet, carte[COLONNES_RESULTATS.CANDIDAT]).setFontWeight('bold').setFontColor(primaryColor);
  plageColonne_(resultsSheet, carte[COLONNES_RESULTATS.FICHIER]).setFontColor(textMuted).setHorizontalAlignment('center');
  entetes.forEach((nom) => appliquerFormatColonne_(resultsSheet, carte, nom));

  const recommandations = plageColonne_(resultsSheet, carte[COLONNES_RESULTATS.RECOMMANDATION]);
  const regle = (texte, fond, encre) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(texte).setBackground(fond).setFontColor(encre).setRanges([recommandations]).build();
  resultsSheet.setConditionalFormatRules([
    regle(RECOMMANDATIONS.CONTACT, '#dcfce7', '#166534'),
    regle(RECOMMANDATIONS.VIVIER, '#fef9c3', '#854d0e'),
    regle(RECOMMANDATIONS.REFUS, '#fee2e2', '#991b1b'),
    regle(RECOMMANDATIONS.DOUBLON, '#f1f5f9', '#475569'),
    regle(RECOMMANDATIONS.A_REANALYSER, '#eff6ff', '#1d4ed8'),
    regle(RECOMMANDATIONS.ERREUR, '#fef2f2', '#dc2626'),
  ]);

  // === 3. Grille d'évaluation : posée si absente, jamais réécrite ===
  assurerOngletGrille_();

  ss.setActiveSheet(resultsSheet);
  ss.toast("Classeur initialisé. Prochaine étape : proposez puis relisez la grille d'évaluation.", '✅ Initialisation réussie', 8);
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
        p { margin-top: 0; margin-bottom: 12px; }
        ol, ul { margin-top: 0; padding-left: 20px; }
        li { margin-bottom: 6px; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; margin-bottom: 12px; }
        td, th { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { background: #f8fafc; }
        .highlight-box { background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 6px; font-weight: 600; font-size: 15px; color: #0f172a; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .warn-box { background-color: #fffbeb; border: 1px solid #fde68a; padding: 16px; border-radius: 6px; font-size: 13.5px; color: #92400e; display: flex; gap: 12px; align-items: flex-start; margin-bottom: 20px; }
        .icon { font-size: 18px; }
        .footer-btn { margin-top: 24px; text-align: right; }
        .btn { background-color: #f1f5f9; color: #475569; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; font-size: 14px; cursor: pointer; transition: all 0.2s; }
        .btn:hover { background-color: #e2e8f0; color: #0f172a; }
      </style>
    </head>
    <body>
      <h2>💡 Bien organiser vos recrutements</h2>
      <div class="highlight-box">1 offre = 1 dossier Drive = 1 classeur</div>

      <h3><span class="icon">🎯</span> 1. La grille d'abord</h3>
      <ol>
        <li>Renseignez l'annonce dans le panneau, puis <b>✨ Proposer la grille</b>.</li>
        <li>Relisez l'onglet « Grille d'évaluation » : un critère par ligne, vérifiable sur un CV. Réservez <b>Indispensable</b> à ce qui doit écarter un CV qui ne le montre pas.</li>
        <li>Lancez l'analyse. Chaque CV est évalué critère par critère, avec un extrait du CV à l'appui.</li>
      </ol>

      <h3><span class="icon">⚖️</span> 2. Comment se décide « À contacter »</h3>
      <table>
        <tr><th>Recommandation</th><th>Condition</th></tr>
        <tr><td>À refuser</td><td>score sous le seuil de vivier</td></tr>
        <tr><td>À garder en vivier</td><td>un indispensable non démontré par le CV ou seulement en partie (« à vérifier »), ou score sous le seuil de contact, ou rang au-delà des places</td></tr>
        <tr><td>À contacter</td><td>score au moins égal au seuil de contact, indispensables démontrés, dans la limite des places</td></tr>
      </table>
      <p>Les places sont un <b>maximum</b> : s'il n'y a que trois bons profils, il y a trois « À contacter ». Un indispensable absent du CV ne fait pas refuser : un CV muet sur un point n'est pas un candidat qui en manque. Le motif de chaque ligne dit pourquoi.</p>

      <h3><span class="icon">🔁</span> 3. Ajuster sans tout refaire</h3>
      <p>Changer un niveau, un poids, un seuil ou le nombre de places, ou retirer un critère : <b>Recalculer le classement</b>, sans appel à Gemini. Ajouter ou reformuler un critère, changer l'annonce, les consignes ou le modèle : les CV concernés passent « À réanalyser » et le sont au prochain lancement.</p>

      <h3><span class="icon">👥</span> 4. Doublons</h3>
      <p>Deux CV avec le même email ou le même téléphone sont la même personne : seule la fiche la mieux notée est classée, l'autre passe « Doublon ». Un même nom sans coordonnée commune est seulement signalé « À vérifier ».</p>

      <h3><span class="icon">🧑‍💼</span> 5. Votre décision prime</h3>
      <p>La colonne « Décision RH » n'est jamais modifiée par l'outil et commande les brouillons d'email. Les emails restent des <b>brouillons Gmail</b> : relisez-les avant envoi. Un seul brouillon par adresse, et jamais deux fois le même.</p>

      <h3><span class="icon">🛡️</span> 6. Confidentialité & RGPD</h3>
      <div class="warn-box">
        <div class="icon">⚠️</div>
        <div>
          <strong>Politique de données Google API :</strong> en palier gratuit, Google se réserve le droit d'utiliser les requêtes pour l'entraînement. <b>Pour un usage professionnel conforme au RGPD, utilisez une clé d'un projet facturé (Pay-as-you-go)</b>.
        </div>
      </div>
      <p>Le nettoyage RGPD met à la corbeille les CV plus anciens que le délai de rétention et pseudonymise leurs lignes, extraits de CV compris.</p>

      <div class="footer-btn">
        <button class="btn" onclick="google.script.host.close()">Fermer le guide</button>
      </div>
    </body>
    </html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent).setWidth(640).setHeight(620);
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
    ${isSet ? '<button class="btn btn-danger" onclick="clearKey()">Supprimer</button>' : ''}
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
  let isEn = false;
  try {
    isEn = String(Session.getActiveUserLocale() || 'fr').startsWith('en');
  } catch (e) {
    isEn = false;
  }

  const title = isEn ? 'About CV Analyzer' : "À propos de l'analyseur de CV";
  const content = isEn
    ? "This tool evaluates CVs against the job ad with Google's Gemini AI, criterion by criterion, using the evaluation grid set by your HR team. The score is computed from that grid, and every recommendation states its reason."
    : "Cet outil évalue les CV au regard de l'annonce avec l'IA Gemini de Google, critère par critère, selon la grille fixée par votre équipe RH. Le score est calculé à partir de cette grille, et chaque recommandation dit son motif.";

  const devTitle = isEn ? 'Developer' : 'Développeur';
  const closeBtn = isEn ? 'Close' : 'Fermer';

  const html = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; padding: 24px; color: #334155; font-size: 14px; margin: 0; background-color: #ffffff; text-align: center; }
    h2 { color: #0f172a; margin-top: 0; font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .version { color: #64748b; font-size: 12px; margin-bottom: 16px; }
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
  <!-- Titre géré par la boîte de dialogue Google (showModalDialog) -->
  <div class="version" style="margin-top: 8px;">Version ${ANALYSEUR_CV_VERSION}</div>
  <p>${content}</p>
  <div class="dev-info">
    <strong>${devTitle} :</strong> Fabrice Faucheux<br><br>
    <a href="https://faucheux.bzh" target="_blank">https://faucheux.bzh</a>
  </div>
  <button class="btn" onclick="google.script.host.close()">${closeBtn}</button>
</body>
</html>`;

  const htmlOutput = HtmlService.createHtmlOutput(html).setWidth(420).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, title);
}
