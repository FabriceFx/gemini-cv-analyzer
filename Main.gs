/**
 * Main.gs
 * Point d'entrée principal pour l'orchestration de l'analyse (lots, CV unique, reprise automatique).
 *
 * Les noms des fonctions publiques sont ceux des versions antérieures : les
 * déclencheurs déjà posés (analyse quotidienne, reprise) les appellent par
 * leur nom, et un renommage les rendrait « introuvables » sans bruit.
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
  let savedSource = 'automated';
  const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState);
      if (parsed && parsed.source) savedSource = parsed.source;
    } catch (e) { }
  }
  _runAnalysis({ interactive: false, isContinuation: true, source: savedSource });
}

function _notifyAutomatedFailure(reason) {
  const userEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
  if (userEmail) {
    MailApp.sendEmail({
      to: userEmail,
      subject: "⚠️ Échec de l'analyse de CV automatique",
      body: `L'analyse automatique n'a pas pu aboutir :\n\n${reason}\n\nOuvrez le classeur et son panneau de contrôle pour corriger la configuration.`,
    });
  }
}

/**
 * Tout ce qu'il faut pour évaluer des CV : clé, annonce de référence, grille,
 * réglages, empreinte du référentiel et contexte Gemini. Lève une erreur qui
 * dit quoi faire si l'un manque.
 */
const preparerAnalyse_ = (canUseUi) => {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("Clé API manquante. Utilisez le menu « 🔑 Configurer la clé API ».");
  const { config, criteres, reglages, empreinte } = referentielCourant_();
  if (!String(config.jobDescription || '').trim()) {
    throw new Error("Annonce manquante : renseignez son texte ou son URL dans le panneau de contrôle.");
  }
  const prompt = promptEffectif_(config);
  if (prompt.ignore && canUseUi) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Prompt personnalisé invalide (il doit contenir {{JOB_DESCRIPTION}} et {{CRITERIA}}) : prompt par défaut utilisé.', '⚠️ Attention');
  }
  const annonce = annonceDeReference_(config, apiKey, config.model, canUseUi);
  const contexte = contexteEvaluation_({
    apiKey, model: config.model, prompt: prompt.prompt, annonce, criteres, consignes: config.criteria,
  });
  return { config, criteres, reglages, empreinte, apiKey, annonce, contexte };
};

/**
 * Fiche à écrire dans l'onglet pour un résultat d'analyse.
 *
 * La recommandation écrite ici est **provisoire** et le motif le dit : les
 * places de contact et les doublons ne se décident qu'une fois tous les CV
 * évalués, par le classement de fin d'analyse.
 */
const ficheDepuisResultat_ = ({ file, analysis, error }, { criteres, reglages, empreinte }) => {
  const maintenant = new Date();
  const C = COLONNES_RESULTATS;
  if (!analysis) {
    Logger.log(`Erreur CV (${file.getName()}) : ${error}`);
    return {
      id: file.getId(),
      nomFichier: file.getName(),
      enErreur: true,
      valeurs: {
        [C.CANDIDAT]: "Erreur d'analyse", [C.EMAIL]: '', [C.TELEPHONE]: '',
        [C.RECOMMANDATION]: RECOMMANDATIONS.ERREUR, [C.SCORE]: '',
        [C.MOTIF]: `Erreur d'analyse : ${String(error).replace(/\.?\s*$/, '.')} Sera retenté au prochain lancement.`,
        [C.DOUBLON]: '', [C.DETAIL]: '', [C.POINTS_FORTS]: '', [C.VIGILANCE]: '', [C.EXPERIENCE]: '', [C.FORMATION]: '',
        [C.FICHIER]: file.getName(), [C.DATE]: maintenant, [C.EVALUATIONS]: '', [C.REFERENTIEL]: '', [C.ID]: file.getId(),
      },
    };
  }
  const resultat = scorerEvaluations_(criteres, analysis.evaluations);
  const base = recommandationDeBase_(resultat, reglages);
  return {
    id: file.getId(),
    nomFichier: file.getName(),
    enErreur: false,
    valeurs: {
      [C.CANDIDAT]: analysis.candidateName || 'Inconnu',
      [C.EMAIL]: analysis.email || 'Non renseigné',
      [C.TELEPHONE]: analysis.phone || 'Non renseigné',
      [C.RECOMMANDATION]: base.recommandation,
      [C.SCORE]: resultat.score,
      [C.MOTIF]: `Provisoire, en attente du classement de fin d'analyse (places, doublons). ${base.motif}`,
      [C.DOUBLON]: '',
      [C.DETAIL]: detailScore_(criteres, analysis.evaluations, resultat),
      [C.POINTS_FORTS]: analysis.strengths,
      [C.VIGILANCE]: analysis.weaknesses,
      [C.EXPERIENCE]: analysis.experience,
      [C.FORMATION]: analysis.education,
      [C.FICHIER]: file.getName(),
      [C.DATE]: maintenant,
      [C.EVALUATIONS]: serialiserEvaluations_(analysis.evaluations),
      [C.REFERENTIEL]: empreinte,
      [C.ID]: file.getId(),
    },
  };
};

/**
 * Synthèse de session : une phrase de conseil, à partir des scores seuls.
 *
 * Les noms ne partent pas : la phrase n'en a pas besoin, et ce qui n'est pas
 * envoyé n'a pas à être protégé.
 */
const ecrireSynthese_ = (feuille, carte, annonce, apiKey, model, canUseUi) => {
  const classes = [RECOMMANDATIONS.CONTACT, RECOMMANDATIONS.VIVIER, RECOMMANDATIONS.REFUS];
  const resume = lireLignesResultats_(feuille, carte)
    .filter((l) => classes.includes(texteLigne_(l, COLONNES_RESULTATS.RECOMMANDATION)))
    .slice(0, 80)
    .map((l, i) => `- Candidat ${i + 1} : ${valeurLigne_(l, COLONNES_RESULTATS.SCORE)}/100, ${texteLigne_(l, COLONNES_RESULTATS.RECOMMANDATION)}`);
  if (resume.length === 0) return;
  try {
    if (canUseUi) SpreadsheetApp.getActiveSpreadsheet().toast('Génération de la synthèse...', 'Synthèse 🧠', 10);
    const synthese = generateSessionSynthesis(resume.join('\n'), annonce, apiKey, model);
    feuille.getRange('A2').setValue(neutraliserFormule_(`Synthèse globale : ${synthese}`));
  } catch (e) {
    Logger.log(`Synthèse non générée : ${e.message}`);
    feuille.getRange('A2').setValue('Synthèse globale : analyse terminée (synthèse indisponible).');
  }
};

/**
 * Fonction principale : liste les fichiers du dossier, analyse ceux qui ne sont
 * pas à jour, puis classe l'ensemble. Gère le découpage en sous-lots, les
 * pauses de quota et la reprise automatique anti-timeout.
 */
function _runAnalysis(options) {
  const isInteractive = Boolean(options && options.interactive);
  const isContinuation = Boolean(options && options.isContinuation);
  const canUseUi = isInteractive && !isContinuation;
  const source = (options && options.source) || (isInteractive ? 'interactive' : 'automated');
  const notifyByEmail = source === 'automated' || (source === 'interactive' && isContinuation);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    if (canUseUi) {
      SpreadsheetApp.getActiveSpreadsheet().toast('Une analyse est déjà en cours, veuillez patienter.', '⏳');
    } else if (source === 'sidebar') {
      const rawState = PropertiesService.getScriptProperties().getProperty(PROP_KEY_JOB_STATE);
      let isAlreadyRunning = false;
      if (rawState) {
        try {
          const parsed = JSON.parse(rawState);
          const elapsed = Date.now() - (parsed.lastUpdated || 0);
          const isRunning = (parsed.status === 'RUNNING' || parsed.status === 'CONTINUING') && elapsed < 15 * 60 * 1000;
          const isScheduled = parsed.status === 'SCHEDULED' && elapsed < 3 * 60 * 1000;
          isAlreadyRunning = isRunning || isScheduled;
        } catch (e) { }
      }
      if (!isAlreadyRunning) {
        _updateProgressState({ status: 'BUSY', errorMessage: "Une analyse est déjà en cours d'exécution." });
      }
    }
    return;
  }

  // Chien de garde à +7 minutes, au cas où l'exécution serait tuée net.
  _scheduleWatchdogTrigger();
  const startTime = Date.now();

  const echouer = (message, messageUi) => {
    if (canUseUi) SpreadsheetApp.getUi().alert(messageUi || message);
    else if (notifyByEmail) _notifyAutomatedFailure(message);
    _updateProgressState({ status: 'ERROR', source, errorMessage: message });
    _cleanupContinuationTriggers();
  };

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    let feuille;
    let carte;
    let prep;
    try {
      ({ feuille, carte } = ongletResultats_());
      prep = preparerAnalyse_(canUseUi);
    } catch (e) {
      echouer(e.message, `Configuration requise : ${e.message}`);
      return;
    }
    const { config, criteres, reglages, empreinte, apiKey, annonce, contexte } = prep;

    const folderUrl = String(config.folderUrl || '').trim();
    if (!folderUrl) {
      echouer("L'URL du dossier Drive des CV est manquante : renseignez-la dans le panneau de contrôle.");
      return;
    }
    const folderId = getFolderIdFromUrl(folderUrl);
    if (!folderId) {
      echouer("L'URL du dossier Drive semble invalide : collez le lien du dossier (…/drive/folders/…).");
      return;
    }
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (e) {
      echouer(`Impossible d'accéder au dossier Drive : ${e.message}. Vérifiez que votre compte y a accès.`);
      return;
    }

    const isPaidAccount = config.accountType === 'Payant (Pay-as-you-go)';
    const batchSize = isPaidAccount ? GEMINI_PAID_BATCH_SIZE : GEMINI_FREE_BATCH_SIZE;
    const batchPauseMs = isPaidAccount ? GEMINI_PAID_BATCH_PAUSE_MS : GEMINI_FREE_BATCH_PAUSE_MS;

    // Quels fichiers sont à jour ? Un fichier l'est si l'une de ses lignes a
    // été évaluée sous le référentiel courant, avec chaque critère actuel.
    const lignesParFichier = new Map();
    lireLignesResultats_(feuille, carte).forEach((ligne) => {
      const fiche = ficheDeClassement_(ligne);
      if (!fiche.id) return;
      if (!lignesParFichier.has(fiche.id)) lignesParFichier.set(fiche.id, []);
      lignesParFichier.get(fiche.id).push(fiche);
    });

    const filesToProcess = [];
    const decompte = { aJour: 0, nouveaux: 0, aReanalyser: 0, aRetenter: 0 };
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().startsWith('tmp_')) continue;
      if (!SUPPORTED_MIME_TYPES.includes(file.getMimeType())) continue;
      const existantes = lignesParFichier.get(file.getId());
      if (existantes && existantes.some((f) => ficheEstAJour_(f, criteres, empreinte))) {
        decompte.aJour++;
        continue;
      }
      filesToProcess.push(file);
      if (!existantes) decompte.nouveaux++;
      else if (existantes.some((f) => f.recommandation === RECOMMANDATIONS.ERREUR)) decompte.aRetenter++;
      else decompte.aReanalyser++;
    }
    const totalFilesCount = filesToProcess.length + decompte.aJour;

    if (filesToProcess.length === 0) {
      // Rien à analyser, mais un poids, un niveau ou un seuil a pu changer : on reclasse.
      const bilan = reclasser_({ feuille, carte, criteres, reglages, empreinte });
      if (canUseUi) {
        SpreadsheetApp.getUi().alert(`Aucun CV à analyser : tous les documents du dossier sont à jour.\n\n${messageBilanClassement_(bilan)}`);
      }
      _updateProgressState({
        status: 'COMPLETED',
        source,
        total: totalFilesCount,
        processed: totalFilesCount,
        topContactCount: bilan.contacts,
        currentFileName: 'Tous les documents sont à jour',
      });
      _cleanupContinuationTriggers();
      return;
    }

    // Confirmation uniquement en interactif classique (pas en reprise) : l'analyse coûte des appels payants.
    if (canUseUi) {
      const ui = SpreadsheetApp.getUi();
      const details = [
        decompte.nouveaux && accorder_(decompte.nouveaux, 'nouveau', 'nouveaux'),
        decompte.aReanalyser && `${decompte.aReanalyser} à réanalyser (annonce, grille, consignes ou modèle modifiés)`,
        decompte.aRetenter && `${decompte.aRetenter} en erreur à retenter`,
      ].filter(Boolean).join(', ');
      const costResponse = ui.alert(
        'Confirmation',
        `${accorder_(filesToProcess.length, 'CV', 'CV')} à analyser : ${details}.\nModèle : ${config.model}. Grille : ${accorder_(criteres.length, 'critère')}.\n\nLancer l'analyse ?`,
        ui.ButtonSet.YES_NO,
      );
      if (costResponse !== ui.Button.YES) {
        _cleanupContinuationTriggers();
        return;
      }
      ss.toast(`Début de l'analyse : ${accorder_(filesToProcess.length, 'document')}.`, 'Lancement 🚀');
    }

    _updateProgressState({
      status: 'RUNNING',
      source,
      total: totalFilesCount,
      processed: decompte.aJour,
      successCount: 0,
      errorCount: 0,
      currentFileName: "Démarrage des lots d'analyse...",
    });

    let successCount = 0;
    let errorCount = 0;
    let stoppedByTimeout = false;
    let maxBatchDuration = 0;
    const allRecentCandidates = [];

    for (let batchStart = 0; batchStart < filesToProcess.length; batchStart += batchSize) {
      const elapsed = Date.now() - startTime;

      // Contrôle de temps proactif AVANT d'engager le lot (si temps écoulé + plus long lot + 30 s > 4 min 30)
      if (batchStart > 0 && elapsed + maxBatchDuration + 30000 > MAX_EXECUTION_TIME) {
        _scheduleContinuationTrigger();
        _updateProgressState({ status: 'CONTINUING', source, currentFileName: 'Reprise automatique programmée dans 1 min...' });
        if (canUseUi) ss.toast('Temps limite approché. Reprise automatique à +1 min.', 'Reprise ⏳', 8);
        stoppedByTimeout = true;
        break;
      }

      const batch = filesToProcess.slice(batchStart, batchStart + batchSize);
      if (canUseUi) {
        ss.toast(`Traitement du lot ${Math.floor(batchStart / batchSize) + 1} (${accorder_(batch.length, 'document')})...`, 'Analyse 🔍');
      }
      _updateProgressState({
        status: 'RUNNING',
        source,
        total: totalFilesCount,
        processed: decompte.aJour + successCount + errorCount,
        currentFileName: batch[0].getName(),
      });

      const batchStartTime = Date.now();
      const fiches = analyzeDocumentsBatch(batch, contexte)
        .map((resultat) => ficheDepuisResultat_(resultat, { criteres, reglages, empreinte }));
      maxBatchDuration = Math.max(maxBatchDuration, Date.now() - batchStartTime);

      enregistrerFiches_(feuille, carte, fiches);
      fiches.forEach((fiche) => {
        if (fiche.enErreur) errorCount++;
        else successCount++;
        allRecentCandidates.push({
          name: fiche.enErreur ? fiche.nomFichier : fiche.valeurs[COLONNES_RESULTATS.CANDIDAT],
          score: fiche.valeurs[COLONNES_RESULTATS.SCORE],
          reco: fiche.valeurs[COLONNES_RESULTATS.RECOMMANDATION],
        });
      });

      _updateProgressState({
        status: 'RUNNING',
        source,
        total: totalFilesCount,
        processed: decompte.aJour + successCount + errorCount,
        successCount,
        errorCount,
        recentCandidates: allRecentCandidates.slice(-6),
        currentFileName: batch[batch.length - 1].getName(),
      });

      // Pause entre lots pour respecter le quota RPM (si temps restant suffisant)
      if (batchStart + batchSize < filesToProcess.length) {
        if (Date.now() - startTime + batchPauseMs + 30000 > MAX_EXECUTION_TIME) {
          _scheduleContinuationTrigger();
          _updateProgressState({ status: 'CONTINUING', source, currentFileName: 'Reprise automatique au prochain lot (+1 min)...' });
          stoppedByTimeout = true;
          break;
        }
        Utilities.sleep(batchPauseMs);
      }
    }

    if (stoppedByTimeout) return;

    _cleanupContinuationTriggers();
    const bilan = reclasser_({ feuille, carte, criteres, reglages, empreinte });
    ecrireSynthese_(feuille, carte, annonce, apiKey, config.model, canUseUi);

    _updateProgressState({
      status: 'COMPLETED',
      source,
      total: totalFilesCount,
      processed: totalFilesCount,
      successCount,
      errorCount,
      topContactCount: bilan.contacts,
      currentFileName: 'Terminé avec succès',
      recentCandidates: allRecentCandidates.slice(-6),
    });

    let endMessage = `Analyse terminée : ${accorder_(successCount, 'CV évalué', 'CV évalués')}.\n${messageBilanClassement_(bilan)}`;
    if (errorCount > 0) endMessage += `\n⚠️ ${accorder_(errorCount, 'fichier en erreur', 'fichiers en erreur')} cette fois-ci (motif dans la colonne « ${COLONNES_RESULTATS.MOTIF} »).`;

    if (canUseUi) {
      SpreadsheetApp.getUi().alert(`Bilan : ${endMessage}`);
    } else if (notifyByEmail) {
      const userEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
      if (userEmail) {
        MailApp.sendEmail({
          to: userEmail,
          subject: '🤖 Analyse de CV terminée',
          body: `Bonjour,\n\nVotre analyse de CV automatique vient de se terminer.\n\n${endMessage}\n\nConsultez le classeur pour découvrir les résultats.`,
        });
      }
    }
  } catch (err) {
    Logger.log(`Erreur globale _runAnalysis : ${err.message}`);
    _updateProgressState({ status: 'ERROR', source, errorMessage: err.message });
    if (canUseUi) {
      SpreadsheetApp.getUi().alert(`Erreur : ${err.message}`);
    } else if (notifyByEmail) {
      _notifyAutomatedFailure(err.message);
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
    SpreadsheetApp.getActiveSpreadsheet().toast('Une analyse est déjà en cours.', '⏳');
    return;
  }

  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.prompt('Analyser un seul CV', 'Collez le lien Google Drive du document (PDF, Google Doc ou DOCX) :', ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) return;

    const fileUrl = response.getResponseText().trim();
    const match = fileUrl.match(/d\/([a-zA-Z0-9-_]+)/) || fileUrl.match(/id=([a-zA-Z0-9-_]+)/);
    if (!match) {
      ui.alert("URL invalide. Assurez-vous qu'elle contient l'identifiant du document.");
      return;
    }

    let file;
    try {
      file = DriveApp.getFileById(match[1]);
    } catch (e) {
      ui.alert("Impossible d'accéder à ce fichier. Vérifiez vos droits de lecture.");
      return;
    }

    const mime = file.getMimeType();
    if (!SUPPORTED_MIME_TYPES.includes(mime)) {
      ui.alert(`Format non supporté (${mime}). Fournissez un PDF, un DOCX ou un Google Doc.`);
      return;
    }

    let feuille;
    let carte;
    let prep;
    try {
      ({ feuille, carte } = ongletResultats_());
      prep = preparerAnalyse_(true);
    } catch (e) {
      ui.alert(`Configuration requise : ${e.message}`);
      return;
    }

    SpreadsheetApp.getActiveSpreadsheet().toast('Analyse du document en cours...', 'Analyse 🔍');
    let fiche;
    try {
      fiche = ficheDepuisResultat_({ file, analysis: analyzeSingleDocument(file, prep.contexte) }, prep);
    } catch (err) {
      fiche = ficheDepuisResultat_({ file, error: err.message }, prep);
    }
    enregistrerFiches_(feuille, carte, [fiche]);
    reclasser_({ feuille, carte, criteres: prep.criteres, reglages: prep.reglages, empreinte: prep.empreinte });

    const ligne = lireLignesResultats_(feuille, carte).find((l) => texteLigne_(l, COLONNES_RESULTATS.ID) === file.getId());
    if (fiche.enErreur || !ligne) {
      ui.alert(`Erreur lors de l'analyse : ${fiche.valeurs[COLONNES_RESULTATS.MOTIF]}`);
      return;
    }
    const doublon = texteLigne_(ligne, COLONNES_RESULTATS.DOUBLON);
    ui.alert([
      `Analyse réussie pour : ${texteLigne_(ligne, COLONNES_RESULTATS.CANDIDAT)}`,
      `Recommandation : ${texteLigne_(ligne, COLONNES_RESULTATS.RECOMMANDATION)}`,
      `Score : ${valeurLigne_(ligne, COLONNES_RESULTATS.SCORE)}/100`,
      `Motif : ${texteLigne_(ligne, COLONNES_RESULTATS.MOTIF)}`,
      doublon ? `Doublon : ${doublon}` : '',
    ].filter(Boolean).join('\n'));
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
      SpreadsheetApp.getActiveSpreadsheet().toast('Analyse automatique désactivée.', 'Off 🚫');
      return;
    }
  }
  ScriptApp.newTrigger('analyzeCVsAutomated').timeBased().everyDays(1).atHour(2).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Analyse automatique activée (quotidienne à 02h00).', 'On ⏰');
}

function clearResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RESULTS_SHEET_NAME);
  if (!sheet) return;

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('Confirmation', "Voulez-vous vraiment vider tout le tableau des résultats d'analyse ? Les décisions RH et les dates de brouillon qu'il porte seront perdues.", ui.ButtonSet.YES_NO);

  if (response === ui.Button.YES) {
    const lastRow = sheet.getLastRow();
    if (lastRow > LIGNE_ENTETE_RESULTATS) {
      sheet.deleteRows(PREMIERE_LIGNE_RESULTATS, lastRow - LIGNE_ENTETE_RESULTATS);
    }
    sheet.getRange('A2').setValue("Synthèse globale : en attente du lancement de l'analyse...");
    _updateProgressState({ status: 'IDLE', source: 'interactive', total: 0, processed: 0, currentFileName: '' });
    ss.toast('Le tableau des résultats a été réinitialisé.', 'Vidé 🧹');
  }
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
    Logger.log(`Erreur mise à jour état progression : ${e.message}`);
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
    Logger.log(`Erreur nettoyage déclencheurs de reprise : ${e.message}`);
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
  Logger.log('Déclencheur de reprise automatique programmé dans 1 minute.');
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
