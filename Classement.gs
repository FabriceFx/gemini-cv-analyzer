/**
 * Classement.gs — score, recommandation, doublons et places de contact. Introduit en v1.0.
 *
 * Tout ce qui décide se trouve ici, en fonctions pures, testées hors Google
 * (banc/test.js). L'IA ne rend que des constats : pour chaque critère de la
 * grille, un statut et un extrait du CV. Le code en tire, dans cet ordre :
 *
 *   1. le score, moyenne pondérée des statuts ;
 *   2. la recommandation, par seuils absolus : jamais par rang. Avant la
 *      v1.0, tout candidat noté 4/5 passait « À contacter » même quand l'IA
 *      l'avait mis en vivier, et le plafond de dix se remplissait toujours ;
 *   3. les doublons : une seule fiche classée par personne ;
 *   4. les places : au plus N « À contacter », et moins s'il y en a moins.
 *
 * La colonne « Décision RH » n'est jamais lue ni écrite ici : la proposition
 * de l'outil ne dépend pas de ce que l'équipe a décidé, et l'inverse non plus.
 */

const SYMBOLE_STATUT_ = Object.freeze({ Satisfait: '✔', Partiel: '◐', 'Non démontré': '✘' });
const STATUT_PAR_CODE_ = Object.freeze({ S: 'Satisfait', P: 'Partiel', N: 'Non démontré' });

/**
 * Rang d'affichage d'un groupe : ce qu'on appelle d'abord, en haut.
 *
 * Une fonction et non une constante : RECOMMANDATIONS vit dans Constants.gs,
 * que l'éditeur peut charger après ce fichier. Une constante globale qui lit
 * une constante d'un autre fichier empêche tout le projet de se charger.
 */
const rangGroupe_ = (recommandation) => ({
  [RECOMMANDATIONS.CONTACT]: 1,
  [RECOMMANDATIONS.VIVIER]: 2,
  [RECOMMANDATIONS.REFUS]: 3,
  [RECOMMANDATIONS.A_REANALYSER]: 4,
  [RECOMMANDATIONS.DOUBLON]: 5,
  [RECOMMANDATIONS.ERREUR]: 6,
}[recommandation]);
const GROUPE_ARCHIVE_ = 7;
const GROUPE_VIDE_ = 8;

const SUITE_A_REANALYSER_ = "Sera réanalysé au prochain lancement s'il est encore dans le dossier (sinon, menu « Analyser un seul CV »).";

/* ------------------------------ Évaluations ------------------------------ */

/**
 * Statuts, preuves et empreinte du critère évalué, par clé de critère, pour
 * la colonne technique « Évaluations (données) ».
 */
const serialiserEvaluations_ = (evaluations) => JSON.stringify({
  v: 1,
  e: Object.fromEntries(Object.entries(evaluations)
    .map(([cle, ev]) => [cle, [CODE_STATUT[ev.statut], ev.preuve || '', ev.empreinte || '']])),
});

/** Relit la colonne technique ; `null` si elle est vide ou illisible — jamais un « tout non démontré ». */
const lireEvaluations_ = (brut) => {
  if (brut === '' || brut === null || brut === undefined) return null;
  try {
    const objet = JSON.parse(String(brut));
    if (!objet || objet.v !== 1 || typeof objet.e !== 'object' || objet.e === null) return null;
    const evaluations = {};
    for (const [cle, triplet] of Object.entries(objet.e)) {
      const statut = Array.isArray(triplet) ? STATUT_PAR_CODE_[triplet[0]] : undefined;
      if (!statut) return null;
      evaluations[cle] = { statut, preuve: String(triplet[1] || ''), empreinte: String(triplet[2] || '') };
    }
    return evaluations;
  } catch (e) {
    return null;
  }
};

/**
 * Une fiche est à jour quand elle a été évaluée sous le référentiel courant
 * (annonce, consignes, prompt, modèle) **et** que chaque critère actuel y
 * figure dans sa rédaction actuelle. Un critère retiré de la grille n'y fait
 * rien : son statut est simplement ignoré.
 */
const ficheEstAJour_ = (fiche, criteres, empreinte) => fiche.referentiel === empreinte
  && fiche.recommandation !== RECOMMANDATIONS.ERREUR
  && Boolean(fiche.evaluations)
  && criteres.every((c) => fiche.evaluations[c.cle] && fiche.evaluations[c.cle].empreinte === c.empreinte);

/** Pourquoi une fiche n'est pas à jour, dit à l'équipe. */
const motifAReanalyser_ = (fiche, criteres, empreinte) => {
  if (fiche.referentiel !== empreinte || !fiche.evaluations) {
    return `Évalué avec une autre annonce, d'autres consignes, un autre prompt ou un autre modèle. ${SUITE_A_REANALYSER_}`;
  }
  const changes = criteres
    .filter((c) => !fiche.evaluations[c.cle] || fiche.evaluations[c.cle].empreinte !== c.empreinte)
    .map((c) => c.texte);
  return `Critère ajouté ou modifié depuis son analyse : ${changes.join(', ')}. ${SUITE_A_REANALYSER_}`;
};

/**
 * Score d'un CV : 100 × Σ(poids × valeur du statut) ÷ Σ(poids), arrondi.
 *
 * Rend `complet: false` si un critère de la grille n'a pas d'évaluation : un
 * critère non évalué n'est pas un critère non démontré, et le compter zéro
 * ferait passer une grille modifiée pour un mauvais candidat.
 */
const scorerEvaluations_ = (criteres, evaluations) => {
  const manquants = criteres.filter((c) => !evaluations || !evaluations[c.cle]);
  if (manquants.length > 0) return { complet: false, manquants: manquants.map((c) => c.texte) };

  const termes = criteres.map((c) => ({ c, valeur: VALEUR_STATUT[evaluations[c.cle].statut] }));
  const totalPoids = criteres.reduce((somme, c) => somme + c.poids, 0);
  const obtenu = termes.reduce((somme, t) => somme + (t.c.poids * t.valeur), 0);
  const score = totalPoids > 0 ? Math.round((100 * obtenu) / totalPoids) : 0;
  const indispensables = criteres.filter((c) => c.niveau === NIVEAUX_CRITERE.INDISPENSABLE);
  const indispensablesAvec = (statut) => indispensables
    .filter((c) => evaluations[c.cle].statut === statut).map((c) => c.texte);

  return {
    complet: true,
    score,
    aDesIndispensables: indispensables.length > 0,
    indispensablesNonDemontres: indispensablesAvec(STATUTS_CRITERE.NON_DEMONTRE),
    indispensablesPartiels: indispensablesAvec(STATUTS_CRITERE.PARTIEL),
    calcul: `Calcul : 100 × (${termes.map((t) => `${formaterNombre_(t.c.poids)}×${formaterNombre_(t.valeur)}`).join(' + ')}) ÷ ${formaterNombre_(totalPoids)} = ${score}`,
  };
};

/**
 * Détail lisible du score : un critère par ligne, son statut, son niveau, son
 * poids et l'extrait du CV qui le justifie, puis le calcul. Un score qui ne
 * sait pas dire d'où il vient ne survit pas à la première contestation.
 */
const detailScore_ = (criteres, evaluations, resultat) => [
  ...criteres.map((c) => {
    const { statut, preuve } = evaluations[c.cle];
    const extrait = statut !== STATUTS_CRITERE.NON_DEMONTRE && preuve ? ` — « ${tronquer_(preuve, 160)} »` : '';
    return `${SYMBOLE_STATUT_[statut]} ${c.texte} (${c.niveau.toLowerCase()}, poids ${formaterNombre_(c.poids)})${extrait}`;
  }),
  resultat.calcul,
].join('\n');

/**
 * Recommandation d'un CV pris seul, par seuils absolus.
 *
 * Un indispensable non démontré refuse quel que soit le score : c'est le sens
 * même d'« indispensable ». Démontré en partie, il plafonne au vivier.
 */
const recommandationDeBase_ = (resultat, reglages) => {
  const { score } = resultat;
  if (resultat.indispensablesNonDemontres.length > 0) {
    return { recommandation: RECOMMANDATIONS.REFUS, motif: `Indispensable non démontré : ${resultat.indispensablesNonDemontres.join(', ')}.` };
  }
  if (score < reglages.seuilVivier) {
    return { recommandation: RECOMMANDATIONS.REFUS, motif: `Score ${score} < seuil de vivier ${reglages.seuilVivier}.` };
  }
  if (resultat.indispensablesPartiels.length > 0) {
    return { recommandation: RECOMMANDATIONS.VIVIER, motif: `Indispensable démontré en partie seulement : ${resultat.indispensablesPartiels.join(', ')}.` };
  }
  if (score < reglages.seuilContact) {
    return { recommandation: RECOMMANDATIONS.VIVIER, motif: `Score ${score} < seuil de contact ${reglages.seuilContact}.` };
  }
  return {
    recommandation: RECOMMANDATIONS.CONTACT,
    motif: `Score ${score} ≥ seuil de contact ${reglages.seuilContact}${resultat.aDesIndispensables ? ', indispensables démontrés' : ''}.`,
  };
};

/* ------------------------------ Identité ------------------------------ */

/** Email comparable, ou `null` si la valeur n'en est pas un (« Non renseigné » compris). */
const cleEmail_ = (valeur) => {
  const email = normaliserEspaces_(valeur).toLowerCase();
  return isValidEmail(email) ? email : null;
};

/**
 * Téléphone comparable : les neuf derniers chiffres.
 *
 * « 06 12 34 56 78 », « +33 6 12 34 56 78 » et « 0033612345678 » donnent
 * « 612345678 », et un nombre lu par Sheets sans son zéro initial aussi.
 * Moins de huit chiffres : pas un numéro, `null`.
 */
const cleTelephone_ = (valeur) => {
  const chiffres = String(valeur ?? '').replace(/\D/g, '');
  return chiffres.length >= 8 ? chiffres.slice(-9) : null;
};

const NOMS_SANS_IDENTITE_ = Object.freeze(['inconnu', "erreur d'analyse", 'pseudonymise', 'non renseigne']);

/**
 * Nom comparable : mots sans accents ni casse, triés — « DUPONT Jean » vaut
 * « Jean Dupont ». Un seul mot ne suffit pas à désigner quelqu'un : `null`.
 */
const cleNom_ = (valeur) => {
  const normal = normaliserComparaison_(valeur);
  if (normal === '' || NOMS_SANS_IDENTITE_.includes(normal)) return null;
  const mots = normal.split(/[^a-z]+/).filter((m) => m.length >= 2);
  return mots.length >= 2 ? [...mots].sort().join(' ') : null;
};

/**
 * Deux noms peuvent-ils désigner la même personne ? Oui si l'un est inconnu,
 * ou si les mots de l'un sont tous dans l'autre (« Jean Dupont » et
 * « Jean Dupont-Martin »).
 */
const nomsCompatibles_ = (a, b) => {
  if (!a || !b) return true;
  const motsA = a.split(' ');
  const motsB = b.split(' ');
  return motsA.every((m) => motsB.includes(m)) || motsB.every((m) => motsA.includes(m));
};

const designation_ = (fiche) => `${fiche.nom || 'Inconnu'} (${fiche.fichier || fiche.id || 'fichier inconnu'})`;

const raisonDoublon_ = (a, b) => {
  if (cleEmail_(a.email) && cleEmail_(a.email) === cleEmail_(b.email)) return 'même email';
  if (cleTelephone_(a.telephone) && cleTelephone_(a.telephone) === cleTelephone_(b.telephone)) return 'même téléphone';
  return 'même email ou téléphone qu\'un autre CV de cette personne';
};

/**
 * Regroupe les fiches d'une même personne et n'en classe qu'une.
 *
 * Même email ou même téléphone : c'est un constat, la fiche passe « Doublon ».
 * Mais une adresse partagée par des noms différents — un cabinet de
 * recrutement qui envoie ses CV sous son propre contact — n'est pas une
 * personne : le groupe est seulement signalé, rien n'est écarté. Même nom
 * sans coordonnée commune : présomption, signalée, sans effet sur le
 * classement. Un fait et une présomption ne se mélangent pas.
 *
 * Fiche retenue : la mieux notée ; à égalité, la plus récemment analysée.
 */
const marquerDoublons_ = (fiches, sorties, indices) => {
  const parent = new Map(indices.map((i) => [i, i]));
  const racine = (i) => {
    let r = i;
    while (parent.get(r) !== r) r = parent.get(r);
    return r;
  };
  const premierParCle = new Map();
  indices.forEach((i) => {
    [`e:${cleEmail_(fiches[i].email)}`, `t:${cleTelephone_(fiches[i].telephone)}`]
      .filter((cle) => !cle.endsWith(':null'))
      .forEach((cle) => {
        if (!premierParCle.has(cle)) {
          premierParCle.set(cle, i);
          return;
        }
        const ra = racine(premierParCle.get(cle));
        const rb = racine(i);
        if (ra !== rb) parent.set(rb, ra);
      });
  });

  const groupes = new Map();
  indices.forEach((i) => {
    const r = racine(i);
    if (!groupes.has(r)) groupes.set(r, []);
    groupes.get(r).push(i);
  });

  const meilleurDabord = (a, b) => (Number(sorties[b].score) - Number(sorties[a].score))
    || ((fiches[b].date ?? -Infinity) - (fiches[a].date ?? -Infinity))
    || (a - b);

  groupes.forEach((membres) => {
    if (membres.length < 2) return;
    const noms = membres.map((i) => cleNom_(fiches[i].nom));
    const conflit = noms.some((a, x) => noms.some((b, y) => y > x && !nomsCompatibles_(a, b)));
    if (conflit) {
      membres.forEach((i) => {
        const autres = membres.filter((j) => j !== i).map((j) => designation_(fiches[j])).join(' ; ');
        sorties[i].doublon = `À vérifier : même email ou téléphone que ${autres}, mais nom différent (cabinet de recrutement, adresse partagée ?).`;
      });
      return;
    }
    const principal = [...membres].sort(meilleurDabord)[0];
    const autres = membres.filter((j) => j !== principal);
    sorties[principal].doublon = `Fiche retenue ; ${autres.length > 1 ? `${autres.length} autres CV` : 'autre CV'} de la même personne : ${autres.map((j) => fiches[j].fichier || fiches[j].id).join(', ')}.`;
    autres.forEach((i) => {
      const raison = raisonDoublon_(fiches[i], fiches[principal]);
      Object.assign(sorties[i], {
        recommandation: RECOMMANDATIONS.DOUBLON,
        doublon: `${raison.charAt(0).toUpperCase()}${raison.slice(1)} que la fiche retenue : ${designation_(fiches[principal])}.`,
        motif: `Même personne que ${designation_(fiches[principal])} (${raison}). Seule la fiche la mieux notée est classée.`,
      });
    });
  });

  const parNom = new Map();
  indices.filter((i) => sorties[i].recommandation !== RECOMMANDATIONS.DOUBLON).forEach((i) => {
    const cle = cleNom_(fiches[i].nom);
    if (!cle) return;
    if (!parNom.has(cle)) parNom.set(cle, []);
    parNom.get(cle).push(i);
  });
  parNom.forEach((membres) => {
    if (membres.length < 2) return;
    membres.forEach((i) => {
      const autres = membres.filter((j) => j !== i).map((j) => designation_(fiches[j])).join(' ; ');
      const note = `À vérifier : même nom que ${autres}, sans email ni téléphone commun.`;
      sorties[i].doublon = sorties[i].doublon ? `${sorties[i].doublon} ${note}` : note;
    });
  });
};

/**
 * Au plus `placesContact` fiches « À contacter », les mieux notées ; les
 * suivantes passent en vivier, avec leur rang. **Jamais de promotion** : s'il
 * n'y a que trois candidats au-dessus du seuil, il y a trois « À contacter ».
 *
 * À score égal, l'ordre d'arrivée (date d'analyse) départage, et le motif le
 * dit : un rang ex æquo tranché en silence ne se défend pas en réunion.
 */
const attribuerPlaces_ = (fiches, sorties, indices, reglages) => {
  const eligibles = indices
    .filter((i) => sorties[i].recommandation === RECOMMANDATIONS.CONTACT)
    .sort((a, b) => (sorties[b].score - sorties[a].score)
      || ((fiches[a].date ?? Infinity) - (fiches[b].date ?? Infinity))
      || (a - b));
  const total = eligibles.length;
  const places = reglages.placesContact;
  const dernierRetenu = eligibles[Math.min(places, total) - 1];
  eligibles.forEach((i, rang) => {
    if (rang < places) {
      sorties[i].motif = `${sorties[i].motif} Rang ${rang + 1} sur ${total} au-dessus du seuil.`;
      return;
    }
    const exAequo = sorties[i].score === sorties[dernierRetenu].score;
    Object.assign(sorties[i], {
      recommandation: RECOMMANDATIONS.VIVIER,
      motif: `Au-delà des ${places} places de contact : rang ${rang + 1} sur ${total} au-dessus du seuil (score ${sorties[i].score})${exAequo ? ', ex æquo avec le dernier retenu et départagé par l\'ordre d\'arrivée' : ''}.`,
    });
  });
};

/**
 * Classe toutes les fiches de l'onglet.
 *
 * @param {Object[]} fiches   Lignes lues (voir ficheDeClassement_)
 * @param {Object[]} criteres Grille courante
 * @param {{seuilContact: number, seuilVivier: number, placesContact: number}} reglages
 * @param {string} empreinte  Empreinte du référentiel courant
 * @returns {Object[]} Pour chaque fiche, dans le même ordre : recommandation,
 *   score, motif, doublon, detail, ordre.
 */
const classerFiches_ = (fiches, criteres, reglages, empreinte) => {
  const sorties = fiches.map((f) => ({
    recommandation: f.recommandation, score: f.score, motif: f.motif, doublon: f.doublon || '', detail: f.detail, groupe: null, ordre: 0,
  }));

  const estAJour = (f) => ficheEstAJour_(f, criteres, empreinte);

  // Un même fichier sur deux lignes (laissé par une version antérieure) : une seule compte.
  const lignesParFichier = new Map();
  fiches.forEach((f, i) => {
    if (!f.id) return;
    if (!lignesParFichier.has(f.id)) lignesParFichier.set(f.id, []);
    lignesParFichier.get(f.id).push(i);
  });
  const ligneRetenue = new Map();
  lignesParFichier.forEach((indices, id) => {
    const aJour = indices.find((i) => estAJour(fiches[i]));
    ligneRetenue.set(id, aJour === undefined ? indices[0] : aJour);
  });

  const evalues = [];
  fiches.forEach((f, i) => {
    const sortie = sorties[i];
    if (!f.id && !f.nom) {
      sortie.groupe = GROUPE_VIDE_;
      return;
    }
    if (f.nom === PSEUDONYME || f.fichier === FICHIER_PURGE) {
      sortie.groupe = GROUPE_ARCHIVE_;
      return;
    }
    sortie.doublon = '';
    if (f.id && ligneRetenue.get(f.id) !== i) {
      Object.assign(sortie, {
        recommandation: RECOMMANDATIONS.DOUBLON,
        doublon: `Même fichier que la ligne de ${designation_(fiches[ligneRetenue.get(f.id)])}.`,
        motif: 'Même fichier analysé deux fois (ligne laissée par une version précédente). Seule l\'autre ligne est classée.',
      });
      return;
    }
    if (f.recommandation === RECOMMANDATIONS.ERREUR) {
      sortie.score = '';
      return;
    }
    if (!estAJour(f)) {
      Object.assign(sortie, {
        recommandation: RECOMMANDATIONS.A_REANALYSER, score: '', motif: motifAReanalyser_(f, criteres, empreinte),
      });
      return;
    }
    const resultat = scorerEvaluations_(criteres, f.evaluations);
    const base = recommandationDeBase_(resultat, reglages);
    Object.assign(sortie, {
      recommandation: base.recommandation,
      motif: base.motif,
      score: resultat.score,
      detail: detailScore_(criteres, f.evaluations, resultat),
    });
    evalues.push(i);
  });

  marquerDoublons_(fiches, sorties, evalues);
  attribuerPlaces_(fiches, sorties, evalues, reglages);

  sorties.forEach((s) => {
    if (s.groupe === null) s.groupe = rangGroupe_(s.recommandation) || GROUPE_VIDE_;
  });
  const nombre = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity);
  fiches.map((f, i) => i)
    .sort((a, b) => (sorties[a].groupe - sorties[b].groupe)
      || (nombre(sorties[b].score) - nombre(sorties[a].score))
      || ((fiches[a].date ?? Infinity) - (fiches[b].date ?? Infinity))
      || (a - b))
    .forEach((i, rang) => { sorties[i].ordre = rang + 1; });
  return sorties;
};

/* ------------------------------ Onglet ------------------------------ */

/** Ligne lue → fiche de classement. */
const ficheDeClassement_ = (ligne) => {
  const score = valeurLigne_(ligne, COLONNES_RESULTATS.SCORE);
  return {
    id: texteLigne_(ligne, COLONNES_RESULTATS.ID),
    nom: texteLigne_(ligne, COLONNES_RESULTATS.CANDIDAT),
    email: texteLigne_(ligne, COLONNES_RESULTATS.EMAIL),
    telephone: String(valeurLigne_(ligne, COLONNES_RESULTATS.TELEPHONE) ?? ''),
    fichier: texteLigne_(ligne, COLONNES_RESULTATS.FICHIER),
    date: instantEnMs_(valeurLigne_(ligne, COLONNES_RESULTATS.DATE)),
    referentiel: texteLigne_(ligne, COLONNES_RESULTATS.REFERENTIEL),
    evaluations: lireEvaluations_(valeurLigne_(ligne, COLONNES_RESULTATS.EVALUATIONS)),
    recommandation: texteLigne_(ligne, COLONNES_RESULTATS.RECOMMANDATION),
    motif: texteLigne_(ligne, COLONNES_RESULTATS.MOTIF),
    score: typeof score === 'number' ? score : '',
    detail: texteLigne_(ligne, COLONNES_RESULTATS.DETAIL),
    doublon: texteLigne_(ligne, COLONNES_RESULTATS.DOUBLON),
  };
};

/**
 * Recalcule tout le classement de l'onglet et le trie.
 *
 * N'écrit que les six colonnes du classement (recommandation, score, motif,
 * doublon, détail, ordre), une colonne d'un seul `setValues` chacune ; puis
 * trie les lignes entières, qui emportent « Décision RH », la date de
 * brouillon et les colonnes de l'équipe avec elles.
 * @returns {Object} Bilan chiffré (voir messageBilanClassement_).
 */
const reclasser_ = ({ feuille, carte, criteres, reglages, empreinte }) => {
  const lignes = lireLignesResultats_(feuille, carte);
  const bilan = { lignes: lignes.length, contacts: 0, vivier: 0, refus: 0, doublons: 0, aReanalyser: 0, erreurs: 0, places: reglages.placesContact };
  if (lignes.length === 0) return bilan;

  const sorties = classerFiches_(lignes.map(ficheDeClassement_), criteres, reglages, empreinte);
  const valeurs = {
    [COLONNES_RESULTATS.RECOMMANDATION]: (s) => s.recommandation,
    [COLONNES_RESULTATS.SCORE]: (s) => s.score,
    [COLONNES_RESULTATS.MOTIF]: (s) => s.motif,
    [COLONNES_RESULTATS.DOUBLON]: (s) => s.doublon,
    [COLONNES_RESULTATS.DETAIL]: (s) => s.detail,
    [COLONNES_RESULTATS.ORDRE]: (s) => s.ordre,
  };
  COLONNES_ECRITES_AU_CLASSEMENT.forEach((nom) => {
    const position = colonneResultats_(carte, nom);
    feuille.getRange(PREMIERE_LIGNE_RESULTATS, position + 1, lignes.length, 1)
      .setValues(sorties.map((s) => {
        const v = valeurs[nom](s);
        return [neutraliserFormule_(v === undefined || v === null ? '' : v)];
      }));
  });
  feuille.getRange(PREMIERE_LIGNE_RESULTATS, 1, lignes.length, feuille.getLastColumn())
    .sort({ column: colonneResultats_(carte, COLONNES_RESULTATS.ORDRE) + 1, ascending: true });
  SpreadsheetApp.flush();

  const compter = (reco) => sorties.filter((s) => s.recommandation === reco).length;
  return Object.assign(bilan, {
    contacts: compter(RECOMMANDATIONS.CONTACT),
    vivier: compter(RECOMMANDATIONS.VIVIER),
    refus: compter(RECOMMANDATIONS.REFUS),
    doublons: compter(RECOMMANDATIONS.DOUBLON),
    aReanalyser: compter(RECOMMANDATIONS.A_REANALYSER),
    erreurs: compter(RECOMMANDATIONS.ERREUR),
  });
};

/** Le bilan tel qu'on le dit à l'équipe. */
const messageBilanClassement_ = (bilan) => {
  if (bilan.lignes === 0) return 'Aucun CV dans l\'onglet des résultats.';
  const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  const lignes = [
    `${pluriel(bilan.contacts, 'candidat', 'candidats')} à contacter (${bilan.places} places au plus), ${bilan.vivier} en vivier, ${pluriel(bilan.refus, 'refus', 'refus')}.`,
  ];
  if (bilan.contacts === 0) {
    lignes.push('Aucun CV n\'atteint le seuil de contact : aucune place n\'est attribuée par défaut.');
  } else if (bilan.contacts < bilan.places) {
    lignes.push(`${bilan.contacts === 1 ? 'Un seul CV atteint' : `Seuls ${bilan.contacts} CV atteignent`} le seuil de contact : les ${bilan.places - bilan.contacts} autres places restent libres, sans repêchage.`);
  }
  if (bilan.doublons > 0) lignes.push(`${pluriel(bilan.doublons, 'doublon écarté', 'doublons écartés')} (même personne, une seule fiche classée).`);
  if (bilan.aReanalyser > 0) {
    lignes.push(`${pluriel(bilan.aReanalyser, 'CV évalué', 'CV évalués')} avec une autre annonce ou une autre grille : lancez l'analyse pour ${bilan.aReanalyser > 1 ? 'les' : 'le'} réévaluer.`);
  }
  if (bilan.erreurs > 0) lignes.push(`${pluriel(bilan.erreurs, 'CV en erreur', 'CV en erreur')}, à retenter au prochain lancement.`);
  return lignes.join('\n');
};

/**
 * Tout ce qui fixe l'évaluation, sans appeler Gemini : grille, réglages,
 * empreinte. Le recalcul du classement fonctionne donc sans clé API.
 */
const referentielCourant_ = () => {
  const config = getConfig();
  const criteres = exigerGrille_();
  const reglages = {
    seuilContact: config.seuilContact,
    seuilVivier: config.seuilVivier,
    placesContact: config.placesContact,
  };
  const erreurReglages = verifierReglagesSelection_(reglages);
  if (erreurReglages) throw new Error(`${erreurReglages} Corrigez les réglages de sélection dans le panneau.`);
  const empreinte = empreinteReferentiel_({
    annonce: config.jobDescription,
    consignes: config.criteria,
    prompt: promptEffectif_(config).prompt,
    modele: config.model,
  });
  return { config, criteres, reglages, empreinte };
};

/** Recalcule le classement de l'onglet avec la grille et les réglages courants. */
const reclasserAvecReferentielCourant_ = () => {
  const { feuille, carte } = ongletResultats_();
  const { criteres, reglages, empreinte } = referentielCourant_();
  return reclasser_({ feuille, carte, criteres, reglages, empreinte });
};

/**
 * Menu : recalcule le classement sans réanalyser — après un changement de
 * niveau, de poids ou de seuil.
 */
function recalculerClassement() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    ui.alert('Une analyse est en cours ; le classement sera recalculé à sa fin.');
    return;
  }
  try {
    const bilan = reclasserAvecReferentielCourant_();
    ui.alert('Classement recalculé', messageBilanClassement_(bilan), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(`Classement non recalculé : ${e.message}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Panneau : même chose, avec un compte rendu au lieu d'une boîte de dialogue.
 * @returns {{ok: boolean, message: string}}
 */
function recalculerClassementDepuisPanneau() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, message: 'Une analyse est en cours ; le classement sera recalculé à sa fin.' };
  }
  try {
    return { ok: true, message: messageBilanClassement_(reclasserAvecReferentielCourant_()) };
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}
