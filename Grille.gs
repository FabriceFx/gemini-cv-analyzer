/**
 * Grille.gs — la grille d'évaluation. Introduit en v1.0.
 *
 * Pourquoi une grille : jusqu'à la v1.0, Gemini rendait pour chaque CV une
 * note globale de 1 à 5 et choisissait lui-même « les 3 compétences clés ».
 * Deux CV n'étaient donc pas jugés sur les mêmes critères, la note n'avait que
 * cinq crans (des dizaines d'ex æquo) et personne ne pouvait dire pourquoi un
 * candidat avait 4 plutôt que 3.
 *
 * Désormais l'équipe RH fixe les critères dans l'onglet « Grille
 * d'évaluation » ; Gemini ne fait que constater, critère par critère et preuve
 * à l'appui, ce que le CV démontre ; le score est calculé par le code
 * (Classement.gs). Le jugement reste à l'équipe, la lecture à l'IA.
 *
 * Ce que chaque changement coûte :
 *   - ajouter ou reformuler un critère, changer ses précisions : ce que l'IA
 *     lit → les CV sont réanalysés au prochain lancement ;
 *   - retirer un critère, changer un niveau ou un poids : ce que le code
 *     calcule → simple recalcul, sans appel à Gemini.
 */

/** Note de chaque en-tête. Construite à l'appel : COLONNES_GRILLE vit dans un autre fichier. */
const notesEnteteGrille_ = () => ({
  [COLONNES_GRILLE.CRITERE]: 'Un élément vérifiable à la lecture d\'un CV : compétence, expérience et sa durée, diplôme, langue, outil, secteur. Un critère par ligne.\n\nAjouter ou reformuler un critère oblige à réanalyser les CV ; en retirer un ne demande qu\'un recalcul (menu « Recalculer le classement »).',
  [COLONNES_GRILLE.NIVEAU]: 'Indispensable : un CV qui ne le démontre pas est refusé ; démontré en partie, il reste au mieux en vivier.\nImportant, Souhaitable : ne comptent que dans le score.\n\nChanger un niveau ne demande pas de réanalyse : menu « Recalculer le classement ».',
  [COLONNES_GRILLE.POIDS]: 'Poids du critère dans le score (nombre positif).\nVide : 3 pour Indispensable, 2 pour Important, 1 pour Souhaitable.\n\nChanger un poids ne demande pas de réanalyse : menu « Recalculer le classement ».',
  [COLONNES_GRILLE.PRECISIONS]: 'Facultatif. Ce qui aide l\'IA à trancher : durée minimale, équivalences admises, ce qui ne compte pas.\n\nModifier les précisions oblige à réanalyser les CV.',
});

/** Clé stable d'un critère : son texte, sans accents ni casse. */
const cleCritere_ = (texte) => normaliserComparaison_(texte);

/**
 * Rend l'onglet de la grille, et le pose s'il manque.
 *
 * L'onglet se pose **vide** : une ligne d'exemple serait un critère que
 * personne n'a choisi et qui noterait pourtant tous les CV. C'est le menu
 * « Proposer la grille depuis l'annonce » qui le remplit, à la demande.
 */
const assurerOngletGrille_ = () => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existante = ss.getSheetByName(GRILLE_SHEET_NAME);
  if (existante) return existante;

  const feuille = ss.insertSheet(GRILLE_SHEET_NAME);
  const entetes = [COLONNES_GRILLE.CRITERE, COLONNES_GRILLE.NIVEAU, COLONNES_GRILLE.POIDS, COLONNES_GRILLE.PRECISIONS];
  feuille.getRange(1, 1, 1, entetes.length).setValues([entetes])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f172a')
    .setVerticalAlignment('middle');
  const notes = notesEnteteGrille_();
  feuille.getRange(1, 1, 1, entetes.length).setNotes([entetes.map((nom) => notes[nom])]);
  feuille.setFrozenRows(1);
  feuille.setRowHeight(1, 32);
  feuille.setColumnWidth(1, 320);
  feuille.setColumnWidth(2, 130);
  feuille.setColumnWidth(3, 70);
  feuille.setColumnWidth(4, 420);

  const niveaux = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.values(NIVEAUX_CRITERE), true)
    .setAllowInvalid(false)
    .setHelpText('Indispensable, Important ou Souhaitable.')
    .build();
  feuille.getRange(2, 2, 199, 1).setDataValidation(niveaux);
  const poids = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, 100)
    .setAllowInvalid(false)
    .setHelpText('Un nombre positif. Vide : poids par défaut du niveau.')
    .build();
  feuille.getRange(2, 3, 199, 1).setDataValidation(poids);
  feuille.getRange(2, 1, 199, 4).setWrap(true).setVerticalAlignment('top');
  return feuille;
};

/**
 * Lit la grille et la valide.
 *
 * Rend les critères valides **et** la liste des erreurs, sans lever : le
 * panneau affiche l'état de la grille même quand elle est fautive, et c'est
 * à l'analyse de refuser de partir (voir exigerGrille_).
 * @returns {{absente: boolean, criteres: Object[], erreurs: string[]}}
 */
const lireGrille_ = () => {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GRILLE_SHEET_NAME);
  if (!feuille) return { absente: true, criteres: [], erreurs: [] };

  const hauteur = feuille.getLastRow();
  const largeur = feuille.getLastColumn();
  if (hauteur < 1 || largeur < 1) return { absente: false, criteres: [], erreurs: [] };

  const valeurs = feuille.getRange(1, 1, hauteur, largeur).getValues();
  const entete = valeurs[0].map((v) => String(v ?? '').trim());
  const position = (nom) => entete.indexOf(nom);
  const manquantes = [COLONNES_GRILLE.CRITERE, COLONNES_GRILLE.NIVEAU, COLONNES_GRILLE.POIDS]
    .filter((nom) => position(nom) === -1);
  if (manquantes.length > 0) {
    return {
      absente: false,
      criteres: [],
      erreurs: [`Colonne${manquantes.length > 1 ? 's' : ''} absente${manquantes.length > 1 ? 's' : ''} de l'onglet « ${GRILLE_SHEET_NAME} » : ${manquantes.join(', ')}. Rétablissez l'en-tête de la ligne 1.`],
    };
  }

  const niveauxParCle = new Map(Object.values(NIVEAUX_CRITERE).map((n) => [normaliserComparaison_(n), n]));
  const criteres = [];
  const erreurs = [];
  const clesVues = new Map();

  valeurs.slice(1).forEach((ligne, i) => {
    const numero = i + 2;
    const texte = normaliserEspaces_(ligne[position(COLONNES_GRILLE.CRITERE)]);
    if (texte === '') return;

    const niveauBrut = normaliserComparaison_(ligne[position(COLONNES_GRILLE.NIVEAU)]);
    const niveau = niveauxParCle.get(niveauBrut);
    if (!niveau) {
      erreurs.push(`Ligne ${numero} (« ${tronquer_(texte, 40)} ») : niveau ${niveauBrut ? `« ${ligne[position(COLONNES_GRILLE.NIVEAU)]} » inconnu` : 'vide'}. Choisissez Indispensable, Important ou Souhaitable.`);
      return;
    }

    const poidsBrut = ligne[position(COLONNES_GRILLE.POIDS)];
    const poids = poidsBrut === '' || poidsBrut === null ? POIDS_PAR_DEFAUT[niveau] : Number(poidsBrut);
    if (!Number.isFinite(poids) || poids < 0) {
      erreurs.push(`Ligne ${numero} (« ${tronquer_(texte, 40)} ») : poids « ${poidsBrut} » invalide. Indiquez un nombre positif, ou laissez vide.`);
      return;
    }

    const cle = cleCritere_(texte);
    if (clesVues.has(cle)) {
      erreurs.push(`Ligne ${numero} : le critère « ${tronquer_(texte, 40)} » figure déjà en ligne ${clesVues.get(cle)}.`);
      return;
    }
    clesVues.set(cle, numero);

    const precisions = position(COLONNES_GRILLE.PRECISIONS) === -1
      ? '' : normaliserEspaces_(ligne[position(COLONNES_GRILLE.PRECISIONS)]);
    criteres.push({
      code: `C${criteres.length + 1}`, cle, texte, niveau, poids, precisions, empreinte: empreinteCritere_(cle, precisions),
    });
  });

  if (criteres.length > MAX_CRITERES) {
    erreurs.push(`La grille compte ${criteres.length} critères ; au-delà de ${MAX_CRITERES}, elle ne départage plus les candidatures. Regroupez ou retirez des critères.`);
  }
  if (criteres.length > 0 && criteres.every((c) => c.poids === 0)) {
    erreurs.push('Tous les poids sont nuls : le score vaudrait zéro pour tout le monde. Donnez un poids à au moins un critère.');
  }
  return { absente: false, criteres, erreurs };
};

/** La grille, ou une exception qui dit quoi faire. */
const exigerGrille_ = () => {
  const grille = lireGrille_();
  if (grille.erreurs.length > 0) {
    throw new Error(`La grille d'évaluation est à corriger : ${grille.erreurs.join(' ')}`);
  }
  if (grille.criteres.length === 0) {
    throw new Error("La grille d'évaluation est vide. Menu « ✨ Proposer la grille depuis l'annonce » (ou bouton du panneau), relisez les critères proposés, puis relancez l'analyse.");
  }
  return grille.criteres;
};

/** Résumé pour le panneau : nombre de critères, indispensables, erreurs. */
const resumeGrille_ = () => {
  const grille = lireGrille_();
  return {
    nombre: grille.criteres.length,
    indispensables: grille.criteres.filter((c) => c.niveau === NIVEAUX_CRITERE.INDISPENSABLE).map((c) => c.texte),
    erreurs: grille.erreurs,
  };
};

/**
 * Texte qui remplace {{CRITERIA}} dans le prompt.
 *
 * Ni le niveau ni le poids n'y figurent, volontairement : l'IA doit constater
 * ce que le CV démontre, pas se montrer plus clémente sur un critère parce
 * qu'il est indispensable. C'est aussi ce qui permet de changer un niveau ou
 * un poids sans réanalyser.
 */
const rendreGrillePourPrompt_ = (criteres, consignes) => {
  const lignes = criteres.map((c) => `${c.code}. ${c.texte}${c.precisions ? ` — Précisions : ${c.precisions}` : ''}`);
  return [
    'Critères à évaluer, un statut pour chacun :',
    ...lignes,
    '',
    "Consignes complémentaires de l'équipe RH :",
    normaliserEspaces_(consignes) || 'Aucune.',
  ].join('\n');
};

/**
 * Schéma de réponse, construit pour la grille courante.
 *
 * Chaque critère est une propriété **obligatoire** : Gemini ne peut pas en
 * oublier un, et le code n'a jamais à décider seul ce que vaut un critère non
 * évalué. Les critères viennent avant les points forts et faibles, pour que
 * la synthèse s'écrive après l'examen et non l'inverse.
 */
const schemaEvaluation_ = (criteres) => {
  const codes = criteres.map((c) => c.code);
  const proprietesCriteres = {};
  criteres.forEach((c) => {
    proprietesCriteres[c.code] = {
      type: 'OBJECT',
      description: `Critère ${c.code} : ${tronquer_(c.texte, 120)}`,
      properties: {
        statut: {
          type: 'STRING',
          enum: Object.values(STATUTS_CRITERE),
          description: 'Satisfait : démontré explicitement. Partiel : démontré en partie. Non démontré : le CV ne permet pas de l\'affirmer.',
        },
        preuve: {
          type: 'STRING',
          description: 'Extrait recopié du CV, 150 caractères au plus, qui justifie le statut ; chaîne vide si Non démontré.',
        },
      },
      required: ['statut', 'preuve'],
      propertyOrdering: ['statut', 'preuve'],
    };
  });

  return {
    type: 'OBJECT',
    properties: {
      candidateName: { type: 'STRING', description: "Prénom et nom du candidat. Écrire 'Inconnu' si introuvable." },
      email: { type: 'STRING', description: "Adresse email du candidat. Écrire 'Non renseigné' si introuvable." },
      phone: { type: 'STRING', description: "Numéro de téléphone du candidat. Écrire 'Non renseigné' si introuvable." },
      criteres: {
        type: 'OBJECT',
        description: 'Un statut par critère de la grille, identifié par son code.',
        properties: proprietesCriteres,
        required: codes,
        propertyOrdering: codes,
      },
      experience: { type: 'STRING', description: 'Expériences pertinentes pour le poste, en une phrase.' },
      education: { type: 'STRING', description: 'Diplômes et formations, en une phrase.' },
      strengths: { type: 'STRING', description: 'Points forts pour le poste, en texte fluide.' },
      weaknesses: { type: 'STRING', description: 'Points de vigilance ou questions à poser en entretien, en texte fluide.' },
    },
    required: ['candidateName', 'email', 'phone', 'criteres', 'experience', 'education', 'strengths', 'weaknesses'],
    propertyOrdering: ['candidateName', 'email', 'phone', 'criteres', 'experience', 'education', 'strengths', 'weaknesses'],
  };
};

/**
 * Empreinte de ce qui, hors grille, détermine les statuts rendus par l'IA :
 * annonce (telle que configurée, URL ou texte), consignes, prompt, modèle.
 * Deux CV évalués sous la même empreinte sont comparables ; sinon, le plus
 * ancien est à réanalyser.
 *
 * Le préfixe « r1- » n'est pas décoratif : une empreinte faite de chiffres
 * seuls serait convertie en nombre par Sheets, perdrait ses zéros initiaux, et
 * plus aucune ligne ne serait jamais reconnue comme à jour.
 */
const empreinteReferentiel_ = ({ annonce, consignes, prompt, modele }) => {
  const matiere = JSON.stringify({
    annonce: normaliserEspaces_(annonce),
    consignes: normaliserEspaces_(consignes),
    prompt: normaliserEspaces_(prompt),
    modele: String(modele),
  });
  return `r1-${empreinteTexte_(matiere).substring(0, 12)}`;
};

/**
 * Empreinte d'un critère : son texte et ses précisions, ce que l'IA lit.
 *
 * Elle est gardée avec chaque statut. C'est ce qui permet de **retirer** un
 * critère sans rien réanalyser, et de ne réanalyser, quand on en ajoute ou en
 * reformule un, que parce qu'il manque — pas parce que « la grille a changé ».
 */
const empreinteCritere_ = (cle, precisions) => `k${empreinteTexte_(`${cle}|${normaliserComparaison_(precisions)}`).substring(0, 8)}`;

const SCHEMA_PROPOSITION_GRILLE_ = Object.freeze({
  type: 'OBJECT',
  properties: {
    criteres: {
      type: 'ARRAY',
      minItems: 3,
      maxItems: 10,
      items: {
        type: 'OBJECT',
        properties: {
          critere: { type: 'STRING', description: 'Le critère, en quelques mots, sans négation.' },
          niveau: { type: 'STRING', enum: ['Indispensable', 'Important', 'Souhaitable'] },
          precisions: { type: 'STRING', description: 'Ce qui aide à trancher (durée minimale, équivalences admises) ; chaîne vide sinon.' },
        },
        required: ['critere', 'niveau', 'precisions'],
        propertyOrdering: ['critere', 'niveau', 'precisions'],
      },
    },
  },
  required: ['criteres'],
});

/** Demande à Gemini une grille tirée de l'annonce. Ne l'écrit pas. */
const proposerCriteres_ = (annonce, consignes, apiKey, model) => {
  const prompt = [
    "Tu prépares la grille d'évaluation des CV pour l'offre d'emploi ci-dessous.",
    '',
    "OFFRE D'EMPLOI",
    annonce,
    '',
    "CONSIGNES DE L'ÉQUIPE RH",
    normaliserEspaces_(consignes) || 'Aucune.',
    '',
    'Propose entre 5 et 10 critères qui permettent de départager les candidatures. Chaque critère :',
    "porte sur un seul élément vérifiable à la lecture d'un CV (compétence, expérience et sa durée, diplôme, certification, langue, outil, secteur) ;",
    'se formule en quelques mots, sans négation ;',
    "reçoit un niveau : « Indispensable » seulement si l'offre l'exige explicitement (exigé, impératif, obligatoire, diplôme réglementé), au point qu'un CV qui ne le montre pas doive être écarté ; « Important » s'il pèse nettement dans le choix ; « Souhaitable » s'il est un plus ;",
    'peut porter des précisions qui aident à trancher (durée minimale, équivalences admises).',
    'Trois critères « Indispensable » au plus.',
    "N'utilise aucun critère discriminatoire (âge, sexe, origine, nationalité, situation de famille, santé, handicap, apparence) ni aucun savoir-être invérifiable sur un CV (motivation, dynamisme, esprit d'équipe).",
  ].join('\n');

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SCHEMA_PROPOSITION_GRILLE_,
      temperature: 0.2,
    },
  };
  const reponse = parseJsonSafely(_extractGeminiText(callGeminiAPI(model, payload, apiKey)));
  const criteres = (reponse && Array.isArray(reponse.criteres) ? reponse.criteres : [])
    .map((c) => ({
      critere: normaliserEspaces_(c.critere),
      niveau: Object.values(NIVEAUX_CRITERE).includes(c.niveau) ? c.niveau : NIVEAUX_CRITERE.IMPORTANT,
      precisions: normaliserEspaces_(c.precisions),
    }))
    .filter((c) => c.critere !== '');
  if (criteres.length === 0) throw new Error("Gemini n'a proposé aucun critère exploitable. Réessayez, ou remplissez la grille à la main.");
  return criteres;
};

/**
 * Écrit une proposition dans la grille, **seulement si elle est vide** : le
 * code ne réécrit jamais une grille que l'équipe a pu retoucher.
 */
const ecrireGrilleProposee_ = (criteres) => {
  const feuille = assurerOngletGrille_();
  const existante = lireGrille_();
  if (existante.erreurs.length > 0) {
    throw new Error(`La grille est à corriger avant toute proposition : ${existante.erreurs.join(' ')}`);
  }
  if (existante.criteres.length > 0) {
    throw new Error(`La grille contient déjà ${existante.criteres.length} critère${existante.criteres.length > 1 ? 's' : ''}. Pour une nouvelle proposition, videz d'abord ses lignes dans l'onglet « ${GRILLE_SHEET_NAME} » (l'en-tête reste).`);
  }
  const lignes = criteres.map((c) => [
    neutraliserFormule_(c.critere), c.niveau, POIDS_PAR_DEFAUT[c.niveau], neutraliserFormule_(c.precisions),
  ]);
  feuille.getRange(2, 1, lignes.length, 4).setValues(lignes);
  SpreadsheetApp.flush();
  return feuille;
};

/** Ce qu'on dit à l'équipe après une proposition : combien, lesquels comptent double, quoi faire. */
const bilanProposition_ = (criteres) => {
  const indispensables = criteres.filter((c) => c.niveau === NIVEAUX_CRITERE.INDISPENSABLE).map((c) => c.critere);
  return `${criteres.length} critères proposés${indispensables.length ? `, dont ${indispensables.length} indispensable${indispensables.length > 1 ? 's' : ''} (${indispensables.join(', ')})` : ''}. `
    + "Relisez-les dans l'onglet « Grille d'évaluation » — surtout les niveaux : un critère indispensable non démontré fait refuser le CV — puis lancez l'analyse.";
};

/** Offre de référence et clé API, ou une exception qui dit quoi renseigner. */
const contexteProposition_ = (canUseUi) => {
  const config = getConfig();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("Clé API manquante. Utilisez le menu « 🔑 Configurer la clé API ».");
  if (!String(config.jobDescription || '').trim()) {
    throw new Error("Renseignez d'abord l'annonce (texte ou URL) dans le panneau de contrôle.");
  }
  const annonce = annonceDeReference_(config, apiKey, config.model, canUseUi);
  return { config, apiKey, annonce };
};

/**
 * Menu : active l'onglet de la grille, et le pose s'il manque.
 */
function ouvrirGrilleEvaluation() {
  const feuille = assurerOngletGrille_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(feuille);
  return { ok: true, message: `Onglet « ${GRILLE_SHEET_NAME} » ouvert.` };
}

/**
 * Menu : propose une grille tirée de l'annonce et l'écrit dans l'onglet vide.
 */
function proposerGrilleEvaluation() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Une analyse est en cours. Attendez sa fin pour préparer la grille : la changer maintenant fausserait les CV déjà évalués.');
    return;
  }
  try {
    const { config, apiKey, annonce } = contexteProposition_(true);
    SpreadsheetApp.getActiveSpreadsheet().toast('Préparation de la grille...', 'Grille ✨');
    const criteres = proposerCriteres_(annonce, config.criteria, apiKey, config.model);
    const feuille = ecrireGrilleProposee_(criteres);
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(feuille);
    ui.alert('Grille proposée', bilanProposition_(criteres), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(`Grille non proposée : ${e.message}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Panneau : enregistre la configuration saisie, puis propose la grille.
 * @param {Object} formData
 * @returns {{ok: boolean, message: string, grille?: Object}}
 */
function proposerGrilleDepuisPanneau(formData) {
  if (formData) {
    const enregistrement = saveConfig(formData);
    if (!enregistrement.ok) return enregistrement;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, message: 'Une analyse est en cours. Attendez sa fin pour préparer la grille.' };
  }
  try {
    const { config, apiKey, annonce } = contexteProposition_(false);
    const criteres = proposerCriteres_(annonce, config.criteria, apiKey, config.model);
    const feuille = ecrireGrilleProposee_(criteres);
    SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(feuille);
    return { ok: true, message: bilanProposition_(criteres), grille: resumeGrille_() };
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}
