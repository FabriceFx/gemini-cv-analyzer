/**
 * EmailService.gs
 * Génère des brouillons d'emails (via l'IA) pour les candidats, d'après la
 * décision RH ou, à défaut, la recommandation de l'outil.
 *
 * Plan puis application : on compte d'abord exactement ce qui sera créé et ce
 * qui est écarté, on le dit, puis on crée. Chaque brouillon est daté sur sa
 * ligne **aussitôt créé** : une génération interrompue (6 minutes) se relance
 * sans recréer ce qui existe déjà. Un seul brouillon par adresse : une
 * personne qui a envoyé deux CV ne reçoit pas une invitation et un refus.
 */

/** Budget de temps, sous le plafond des 6 minutes d'une exécution. */
const DUREE_MAX_BROUILLONS_MS_ = 4.5 * 60 * 1000;

/**
 * Décision qui commande le brouillon d'une ligne.
 *
 * « Décision RH » prime quand elle vaut l'une des trois décisions ; tout
 * autre texte (« Entretien le 12/10 ») veut dire que l'équipe s'en occupe, et
 * aucun brouillon n'est créé. Vide : la recommandation de l'outil.
 */
const decisionEffective_ = (ligne) => {
  const decisionRh = texteLigne_(ligne, COLONNES_RESULTATS.DECISION);
  if (decisionRh) {
    const canonique = DECISIONS_RH.find((d) => normaliserComparaison_(d) === normaliserComparaison_(decisionRh));
    return { decision: canonique || null, source: 'rh' };
  }
  const recommandation = texteLigne_(ligne, COLONNES_RESULTATS.RECOMMANDATION);
  return { decision: DECISIONS_RH.includes(recommandation) ? recommandation : null, source: 'outil', recommandation };
};

/**
 * Plan de la génération en lot : invitations et réponses négatives, et le
 * décompte exact de ce qui est écarté, et pourquoi.
 */
const planBrouillons_ = (lignes) => {
  const exclus = {
    dejaCree: 0, doublon: 0, nonClasse: 0, decisionLibre: 0, vivier: 0, sansEmail: 0, memeAdresse: 0,
  };
  const adressesServies = new Set(lignes
    .filter((l) => texteLigne_(l, COLONNES_RESULTATS.BROUILLON) !== '')
    .map((l) => cleEmail_(texteLigne_(l, COLONNES_RESULTATS.EMAIL)))
    .filter(Boolean));
  const plan = [];

  lignes.forEach((ligne) => {
    const id = texteLigne_(ligne, COLONNES_RESULTATS.ID);
    if (!id) return; // ligne vide ou ajoutée à la main : rien à quoi rattacher un brouillon
    if (texteLigne_(ligne, COLONNES_RESULTATS.BROUILLON) !== '') {
      exclus.dejaCree++;
      return;
    }
    const { decision, source, recommandation } = decisionEffective_(ligne);
    if (!decision) {
      if (source === 'rh') exclus.decisionLibre++;
      else if (recommandation === RECOMMANDATIONS.DOUBLON) exclus.doublon++;
      else exclus.nonClasse++;
      return;
    }
    if (decision === RECOMMANDATIONS.VIVIER) {
      exclus.vivier++;
      return;
    }
    const email = cleEmail_(texteLigne_(ligne, COLONNES_RESULTATS.EMAIL));
    if (!email) {
      exclus.sansEmail++;
      return;
    }
    if (adressesServies.has(email)) {
      exclus.memeAdresse++;
      return;
    }
    adressesServies.add(email);
    plan.push({
      id,
      name: texteLigne_(ligne, COLONNES_RESULTATS.CANDIDAT),
      email,
      recommendation: decision,
      strengths: texteLigne_(ligne, COLONNES_RESULTATS.POINTS_FORTS),
      weaknesses: texteLigne_(ligne, COLONNES_RESULTATS.VIGILANCE),
    });
  });
  return { plan, exclus };
};

/** Ce qui est écarté, dit en clair ; une ligne par motif non nul. */
const messageExclusions_ = (exclus) => [
  exclus.dejaCree && `${accorder_(exclus.dejaCree, 'ligne a', 'lignes ont')} déjà un brouillon (colonne « ${COLONNES_RESULTATS.BROUILLON} »).`,
  exclus.memeAdresse && `${accorder_(exclus.memeAdresse, 'ligne partage', 'lignes partagent')} l'adresse d'un candidat déjà servi.`,
  exclus.doublon && `${accorder_(exclus.doublon, 'doublon écarté', 'doublons écartés')}.`,
  exclus.vivier && `${exclus.vivier} en vivier (brouillon possible un par un depuis le panneau).`,
  exclus.decisionLibre && `${accorder_(exclus.decisionLibre, 'décision RH libre', 'décisions RH libres')} (autre que les trois décisions) : l'équipe s'en occupe.`,
  exclus.nonClasse && `${accorder_(exclus.nonClasse, 'ligne', 'lignes')} en erreur ou à réanalyser.`,
  exclus.sansEmail && `${accorder_(exclus.sansEmail, 'candidat', 'candidats')} sans adresse email valide.`,
].filter(Boolean).join('\n');

/** Date le brouillon sur la ligne du fichier, relue maintenant : l'onglet a pu être trié entre-temps. */
const marquerBrouillon_ = (feuille, carte, idFichier) => {
  const numero = ligneDuFichier_(feuille, carte, idFichier);
  if (!numero) {
    Logger.log(`Brouillon créé mais ligne introuvable pour le fichier ${idFichier}.`);
    return false;
  }
  feuille.getRange(numero, colonneResultats_(carte, COLONNES_RESULTATS.BROUILLON) + 1).setValue(new Date());
  SpreadsheetApp.flush();
  return true;
};

function draftEmailsForCandidates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert("Une analyse est en cours : elle trie l'onglet des résultats. Générez les brouillons à sa fin.");
    return;
  }

  try {
    let feuille;
    let carte;
    try {
      ({ feuille, carte } = ongletResultats_());
    } catch (e) {
      ui.alert(e.message);
      return;
    }

    const lignes = lireLignesResultats_(feuille, carte);
    if (lignes.length === 0) {
      ui.alert('Aucun candidat dans le tableau.');
      return;
    }

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      ui.alert('Configurez votre clé API Gemini (menu « 🔑 Configurer la clé API ») pour rédiger les emails.');
      return;
    }
    const { model } = getConfig();

    const { plan, exclus } = planBrouillons_(lignes);
    const ecartes = messageExclusions_(exclus);
    if (plan.length === 0) {
      ui.alert(`Aucun brouillon à créer.${ecartes ? `\n\n${ecartes}` : ''}`);
      return;
    }

    const invitations = plan.filter((p) => p.recommendation === RECOMMANDATIONS.CONTACT).length;
    const refus = plan.length - invitations;
    const response = ui.alert("Génération d'emails via l'IA",
      `Vous allez créer ${accorder_(plan.length, 'brouillon')} dans Gmail : ${accorder_(invitations, 'invitation')} à un premier échange et ${accorder_(refus, 'réponse négative', 'réponses négatives')}.\n`
      + 'La colonne « Décision RH » prime ; à défaut, la recommandation de l\'outil.'
      + `${ecartes ? `\n\nÉcartés :\n${ecartes}` : ''}\n\nContinuer ?`,
      ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) return;

    ss.toast('Génération des brouillons en cours...', '📧 Emails', 10);

    const debut = Date.now();
    let crees = 0;
    const echecs = [];
    for (const candidat of plan) {
      if (Date.now() - debut > DUREE_MAX_BROUILLONS_MS_) break;
      const resultat = _createCandidateDraft(candidat, apiKey, model);
      if (!resultat.ok) {
        echecs.push(`${candidat.name} : ${resultat.message}`);
        Logger.log(`Échec génération email pour ${candidat.name} : ${resultat.message}`);
        continue;
      }
      // L'enregistrement suit l'action : une trace pour un brouillon qui n'existerait pas ne se verrait jamais.
      marquerBrouillon_(feuille, carte, candidat.id);
      crees++;
      Utilities.sleep(1500); // Pause pour respecter les quotas Gemini
    }

    const restants = plan.length - crees - echecs.length;
    const bilan = [`${accorder_(crees, 'brouillon créé', 'brouillons créés')} dans votre boîte Gmail.`];
    if (restants > 0) bilan.push(`Temps limite atteint : ${restants} restent à créer. Relancez la génération ; les brouillons déjà créés ne seront pas refaits.`);
    if (echecs.length > 0) bilan.push(`${accorder_(echecs.length, 'échec', 'échecs')}, à relancer :\n${echecs.slice(0, 10).join('\n')}`);
    ui.alert(`Génération terminée.\n\n${bilan.join('\n\n')}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Construit le prompt de génération d'email personnalisé selon la décision du recruteur.
 * @param {string} candidateName
 * @param {string} recommendation
 * @param {string} strengths
 * @param {string} weaknesses
 * @returns {string}
 */
function _buildCandidateEmailPrompt(candidateName, recommendation, strengths, weaknesses) {
  const firstName = (!candidateName || candidateName === 'Inconnu') ? '' : (candidateName.split(' ')[0] || candidateName);
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';

  let decisionContext = 'Nous ne retenons pas sa candidature pour ce poste.';
  if (recommendation === RECOMMANDATIONS.CONTACT) {
    decisionContext = 'Nous souhaitons le contacter pour un premier échange / entretien téléphonique.';
  } else if (recommendation === RECOMMANDATIONS.VIVIER) {
    decisionContext = "Son profil est intéressant mais nous ne donnons pas suite immédiatement pour cette offre précise ; nous souhaitons conserver sa candidature dans notre vivier de talents pour de futures opportunités.";
  }

  return `Agis comme un recruteur bienveillant et professionnel.
Rédige un email très court et poli à l'intention du candidat.
Contexte : Le candidat a postulé à une de nos offres.
Décision : ${decisionContext}
Ses points forts (à mentionner brièvement s'ils sont pertinents) : ${strengths || 'Non spécifiés'}
Raisons du refus ou points à creuser : ${weaknesses || 'Non spécifiés'}
Rédige uniquement le corps de l'email (pas d'objet, pas de placeholders pour ma signature). Commence directement par '${greeting}'`;
}

/**
 * Crée un brouillon Gmail pour un candidat donné.
 * @param {{name: string, email: string, recommendation: string, strengths: string, weaknesses: string}} candidate
 * @param {string} apiKey
 * @param {string} model
 * @returns {{ok: boolean, message: string}}
 */
function _createCandidateDraft(candidate, apiKey, model) {
  if (!candidate.email || !isValidEmail(candidate.email)) {
    return { ok: false, message: 'Adresse email invalide ou manquante.' };
  }

  if (!DECISIONS_RH.includes(candidate.recommendation)) {
    return { ok: false, message: `Aucun email pour une ligne « ${candidate.recommendation || 'sans décision'} ». Indiquez une décision dans la colonne « ${COLONNES_RESULTATS.DECISION} ».` };
  }

  const prompt = _buildCandidateEmailPrompt(candidate.name, candidate.recommendation, candidate.strengths, candidate.weaknesses);

  try {
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    };

    const emailBody = _extractGeminiText(callGeminiAPI(model, payload, apiKey));

    let subject = 'Suite à votre candidature';
    if (candidate.recommendation === RECOMMANDATIONS.CONTACT) {
      subject = 'Suite à votre candidature - Échange téléphonique';
    } else if (candidate.recommendation === RECOMMANDATIONS.VIVIER) {
      subject = 'Suite à votre candidature - Conservation de votre profil';
    }

    GmailApp.createDraft(candidate.email, subject, emailBody);
    return { ok: true, message: `Brouillon créé pour ${candidate.name}.` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
