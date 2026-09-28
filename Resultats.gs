/**
 * Resultats.gs — lecture et écriture de l'onglet Résultats. Introduit en v1.0.
 *
 * Les colonnes se retrouvent **par leur en-tête** (ligne 3), jamais par leur
 * rang. Avant la v1.0, treize indices en dur : une colonne « Commentaires »
 * insérée par l'équipe RH décalait toutes les écritures, et la note partait
 * dans la colonne du voisin. Désormais l'équipe peut ajouter, déplacer ou
 * masquer des colonnes ; le code n'écrit que dans les siennes.
 */

/** En-tête de l'onglet : libellés et position (base 0) de chaque colonne nommée. */
const lireEnteteResultats_ = (feuille) => {
  const largeur = Math.max(feuille.getLastColumn(), 1);
  const entete = feuille.getRange(LIGNE_ENTETE_RESULTATS, 1, 1, largeur).getValues()[0]
    .map((v) => String(v ?? '').trim());
  const carte = {};
  entete.forEach((nom, i) => {
    if (nom !== '' && !(nom in carte)) carte[nom] = i;
  });
  return { entete, carte };
};

/**
 * Position d'une colonne, ou une exception qui dit laquelle manque et quoi
 * faire. Un `undefined` silencieux deviendrait une écriture en colonne A.
 */
const colonneResultats_ = (carte, nom) => {
  if (!(nom in carte)) {
    throw new Error(`La colonne « ${nom} » est absente de l'onglet « ${RESULTS_SHEET_NAME} » (ligne ${LIGNE_ENTETE_RESULTATS}). `
      + 'Rétablissez son en-tête, ou réinitialisez l\'onglet par le menu « ⚙️ Initialiser / réinitialiser les feuilles ».');
  }
  return carte[nom];
};

/** Plage « toute la colonne » à partir de la première ligne de données. */
const plageColonne_ = (feuille, position) => feuille.getRange(
  PREMIERE_LIGNE_RESULTATS, position + 1, feuille.getMaxRows() - PREMIERE_LIGNE_RESULTATS + 1, 1);

/**
 * Formats d'une colonne de l'outil : texte forcé, nombre, date, liste, masquage.
 * Appliqué à la création de l'onglet et à chaque colonne ajoutée par mise à niveau.
 */
const appliquerFormatColonne_ = (feuille, carte, nom) => {
  const position = carte[nom];
  const plage = plageColonne_(feuille, position);
  switch (nom) {
    case COLONNES_RESULTATS.TELEPHONE:
    case COLONNES_RESULTATS.REFERENTIEL:
    case COLONNES_RESULTATS.ID:
      // Texte forcé : « 06… » perdrait son zéro, une empreinte tout en chiffres deviendrait un nombre.
      plage.setNumberFormat('@');
      break;
    case COLONNES_RESULTATS.SCORE:
      plage.setNumberFormat('0').setHorizontalAlignment('center').setFontWeight('bold');
      break;
    case COLONNES_RESULTATS.RECOMMANDATION:
      plage.setHorizontalAlignment('center').setFontWeight('bold');
      break;
    case COLONNES_RESULTATS.DATE:
    case COLONNES_RESULTATS.BROUILLON:
      plage.setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
      break;
    case COLONNES_RESULTATS.DECISION:
      plage.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(DECISIONS_RH, true)
        .setAllowInvalid(true)
        .setHelpText('Votre décision : elle prime sur la recommandation pour les brouillons d\'email, et le code ne la modifie jamais. Tout autre texte (« Entretien le 12/10 ») est accepté mais ne génère pas de brouillon.')
        .build())
        .setHorizontalAlignment('center').setFontWeight('bold');
      break;
    default:
      break;
  }
  if (COLONNES_TECHNIQUES.includes(nom)) feuille.hideColumns(position + 1);
};

/**
 * Ajoute à droite les colonnes apparues depuis la version qui a créé l'onglet.
 *
 * Purement additif : rien n'est déplacé ni effacé, et les colonnes ajoutées par
 * l'équipe restent où elles sont. C'est ce qui permet de mettre à jour le code
 * sans réinitialiser un classeur qui porte des décisions RH.
 * @returns {Object} La carte des colonnes, à jour.
 */
const assurerColonnesResultats_ = (feuille) => {
  const { entete, carte } = lireEnteteResultats_(feuille);
  const manquantes = ORDRE_COLONNES_RESULTATS.filter((nom) => !(nom in carte));
  if (manquantes.length === 0) return carte;

  const derniere = entete.reduce((d, nom, i) => (nom !== '' ? i + 1 : d), 0);
  const debut = derniere + 1;
  const besoin = derniere + manquantes.length;
  if (besoin > feuille.getMaxColumns()) {
    feuille.insertColumnsAfter(feuille.getMaxColumns(), besoin - feuille.getMaxColumns());
  }
  feuille.getRange(LIGNE_ENTETE_RESULTATS, debut, 1, manquantes.length).setValues([manquantes])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#0f172a')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  manquantes.forEach((nom, i) => {
    carte[nom] = debut - 1 + i;
    appliquerFormatColonne_(feuille, carte, nom);
  });
  Logger.log(`Onglet Résultats mis à niveau : ${manquantes.join(', ')}.`);
  return carte;
};

/** Onglet Résultats mis à niveau, ou une exception qui dit comment le créer. */
const ongletResultats_ = () => {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_SHEET_NAME);
  if (!feuille) {
    throw new Error(`L'onglet « ${RESULTS_SHEET_NAME} » est introuvable. Utilisez d'abord le menu « ⚙️ Initialiser / réinitialiser les feuilles ».`);
  }
  return { feuille, carte: assurerColonnesResultats_(feuille) };
};

/** Toutes les lignes de données, lues en un seul bloc. */
const lireLignesResultats_ = (feuille, carte) => {
  const derniere = feuille.getLastRow();
  if (derniere < PREMIERE_LIGNE_RESULTATS) return [];
  const largeur = feuille.getLastColumn();
  return feuille.getRange(PREMIERE_LIGNE_RESULTATS, 1, derniere - PREMIERE_LIGNE_RESULTATS + 1, largeur)
    .getValues()
    .map((cellules, i) => ({ numero: PREMIERE_LIGNE_RESULTATS + i, cellules, carte }));
};

/** Valeur d'une ligne lue, par nom de colonne ; '' si la colonne n'existe pas. */
const valeurLigne_ = (ligne, nom) => (nom in ligne.carte ? ligne.cellules[ligne.carte[nom]] : '');

/** Texte d'une ligne lue, par nom de colonne, espaces rognés. */
const texteLigne_ = (ligne, nom) => String(valeurLigne_(ligne, nom) ?? '').trim();

/** URL d'un fichier Drive, reconstruite à partir de son identifiant. */
const urlFichierDrive_ = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : '');

/**
 * Numéro de ligne actuel d'un fichier, relu au moment d'écrire.
 *
 * Jamais un numéro mémorisé plus tôt : entre-temps une analyse a pu trier
 * l'onglet, et l'on écrirait sur la ligne d'un autre candidat.
 */
const ligneDuFichier_ = (feuille, carte, idFichier) => {
  const derniere = feuille.getLastRow();
  if (!idFichier || derniere < PREMIERE_LIGNE_RESULTATS) return null;
  const col = colonneResultats_(carte, COLONNES_RESULTATS.ID) + 1;
  const ids = feuille.getRange(PREMIERE_LIGNE_RESULTATS, col, derniere - PREMIERE_LIGNE_RESULTATS + 1, 1).getValues();
  const rang = ids.findIndex((r) => String(r[0] ?? '').trim() === idFichier);
  return rang === -1 ? null : PREMIERE_LIGNE_RESULTATS + rang;
};

/**
 * Regroupe des colonnes en blocs contigus, pour écrire chaque bloc d'un seul
 * `setValues` au lieu d'une cellule à la fois.
 */
const blocsContigus_ = (carte, noms) => {
  const tries = noms.map((nom) => ({ nom, position: colonneResultats_(carte, nom) }))
    .sort((a, b) => a.position - b.position);
  const blocs = [];
  tries.forEach(({ nom, position }) => {
    const dernier = blocs[blocs.length - 1];
    if (dernier && position === dernier.debut + dernier.noms.length) dernier.noms.push(nom);
    else blocs.push({ debut: position, noms: [nom] });
  });
  return blocs;
};

/** Couleur d'encre d'une colonne, celle que pose l'initialisation de l'onglet. */
const couleurColonne_ = (nom) => {
  if (nom === COLONNES_RESULTATS.CANDIDAT) return '#1e40af';
  if (nom === COLONNES_RESULTATS.FICHIER) return '#64748b';
  return '#0f172a';
};

/**
 * Colonnes qu'un échec réécrit sur une ligne existante. Pas le nom, l'email ni
 * le reste : un CV déjà évalué dont la réanalyse échoue garde son identité et
 * son contenu, et ne devient pas « Erreur d'analyse » sans nom.
 */
const colonnesEcritesEnErreur_ = () => [
  COLONNES_RESULTATS.RECOMMANDATION, COLONNES_RESULTATS.SCORE,
  COLONNES_RESULTATS.MOTIF, COLONNES_RESULTATS.DOUBLON,
];

/** Écrit des fiches sur des lignes consécutives, bloc par bloc, dans les seules colonnes `noms`. */
const ecrireFichesSurLignes_ = (feuille, carte, premiereLigne, fiches, noms) => {
  const n = fiches.length;
  if (noms.includes(COLONNES_RESULTATS.TELEPHONE)) {
    // Le format texte se pose AVANT la valeur : après, Sheets aurait déjà fait de « 0612… » un nombre.
    feuille.getRange(premiereLigne, colonneResultats_(carte, COLONNES_RESULTATS.TELEPHONE) + 1, n, 1).setNumberFormat('@');
  }

  const blocs = blocsContigus_(carte, noms);
  blocs.forEach(({ debut, noms: nomsBloc }) => {
    const valeurs = fiches.map((fiche) => nomsBloc.map((nom) => {
      const v = fiche.valeurs[nom];
      return neutraliserFormule_(v === undefined || v === null ? '' : v);
    }));
    // Couleur de la colonne, ou rouge pour une erreur, en un seul appel par bloc :
    // une ligne réanalysée avec succès ne doit pas rester rouge.
    feuille.getRange(premiereLigne, debut + 1, n, nomsBloc.length).setValues(valeurs)
      .setVerticalAlignment('top').setWrap(true)
      .setFontColors(fiches.map((fiche) => nomsBloc.map((nom) => (fiche.enErreur ? '#dc2626' : couleurColonne_(nom)))));
  });

  if (noms.includes(COLONNES_RESULTATS.FICHIER)) {
    feuille.getRange(premiereLigne, colonneResultats_(carte, COLONNES_RESULTATS.FICHIER) + 1, n, 1)
      .setRichTextValues(fiches.map((fiche) => [SpreadsheetApp.newRichTextValue()
        .setText(fiche.nomFichier || fiche.id)
        .setLinkUrl(urlFichierDrive_(fiche.id))
        .build()]));
  }
};

/**
 * Enregistre des fiches : sur sa ligne quand le fichier y figure déjà
 * (réanalyse), en bas sinon.
 *
 * Réécrire sur place plutôt que supprimer puis rajouter : « Décision RH »,
 * « Brouillon créé le » et les colonnes ajoutées par l'équipe restent
 * attachés au candidat. Une suppression les aurait perdus, et la date de
 * brouillon perdue aurait fait créer un second brouillon.
 */
const enregistrerFiches_ = (feuille, carte, fiches) => {
  if (fiches.length === 0) return;
  const derniere = feuille.getLastRow();
  const colId = colonneResultats_(carte, COLONNES_RESULTATS.ID) + 1;
  const ligneParId = new Map();
  if (derniere >= PREMIERE_LIGNE_RESULTATS) {
    feuille.getRange(PREMIERE_LIGNE_RESULTATS, colId, derniere - PREMIERE_LIGNE_RESULTATS + 1, 1).getValues()
      .forEach((r, i) => {
        const id = String(r[0] ?? '').trim();
        if (id !== '' && !ligneParId.has(id)) ligneParId.set(id, PREMIERE_LIGNE_RESULTATS + i);
      });
  }

  const nouvelles = [];
  fiches.forEach((fiche) => {
    const ligne = ligneParId.get(fiche.id);
    if (!ligne) {
      nouvelles.push(fiche);
    } else {
      ecrireFichesSurLignes_(feuille, carte, ligne, [fiche],
        fiche.enErreur ? colonnesEcritesEnErreur_() : COLONNES_ECRITES_A_L_ANALYSE);
    }
  });
  if (nouvelles.length > 0) {
    ecrireFichesSurLignes_(feuille, carte, Math.max(feuille.getLastRow(), LIGNE_ENTETE_RESULTATS) + 1,
      nouvelles, COLONNES_ECRITES_A_L_ANALYSE);
  }
  SpreadsheetApp.flush();
};

/**
 * Fiche d'un candidat telle que le panneau l'affiche.
 * @returns {Object|null}
 */
const ficheCandidatDepuisLigne_ = (ligne) => {
  const id = texteLigne_(ligne, COLONNES_RESULTATS.ID);
  const nom = texteLigne_(ligne, COLONNES_RESULTATS.CANDIDAT);
  if (!id && !nom) return null;
  const score = valeurLigne_(ligne, COLONNES_RESULTATS.SCORE);
  const brouillon = valeurLigne_(ligne, COLONNES_RESULTATS.BROUILLON);
  return {
    fileId: id,
    name: nom || 'Inconnu',
    email: texteLigne_(ligne, COLONNES_RESULTATS.EMAIL),
    phone: texteLigne_(ligne, COLONNES_RESULTATS.TELEPHONE),
    recommendation: texteLigne_(ligne, COLONNES_RESULTATS.RECOMMANDATION),
    score: score === '' || score === null ? '' : Number(score),
    motif: texteLigne_(ligne, COLONNES_RESULTATS.MOTIF),
    decision: texteLigne_(ligne, COLONNES_RESULTATS.DECISION),
    doublon: texteLigne_(ligne, COLONNES_RESULTATS.DOUBLON),
    detail: texteLigne_(ligne, COLONNES_RESULTATS.DETAIL),
    strengths: texteLigne_(ligne, COLONNES_RESULTATS.POINTS_FORTS),
    weaknesses: texteLigne_(ligne, COLONNES_RESULTATS.VIGILANCE),
    experience: texteLigne_(ligne, COLONNES_RESULTATS.EXPERIENCE),
    education: texteLigne_(ligne, COLONNES_RESULTATS.FORMATION),
    brouillon: instantEnMs_(brouillon) === null ? '' : dateLisible_(new Date(instantEnMs_(brouillon))),
    fileName: texteLigne_(ligne, COLONNES_RESULTATS.FICHIER),
    fileUrl: urlFichierDrive_(id),
  };
};
