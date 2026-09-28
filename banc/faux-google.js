/**
 * Banc d'essai — simulateurs des services Google et de l'API Gemini.
 *
 * **Un faux service complaisant valide du code faux.** D'où :
 *
 *   - le faux classeur interprète les chaînes comme Sheets : « =… » devient une
 *     formule, un nombre écrit en texte devient un nombre (sauf format « @ »),
 *     « yyyy-MM-dd » devient une Date, l'apostrophe initiale force le texte ;
 *   - il refuse `undefined`, une plage hors de la feuille, des dimensions qui ne
 *     correspondent pas, avec les messages du vrai ;
 *   - `computeDigest` rend des octets **signés**, comme le vrai ;
 *   - le faux PropertiesService refuse une valeur de plus de 9 Ko ;
 *   - le faux UrlFetchApp lève sur un code ≥ 400 quand `muteHttpExceptions` est absent ;
 *   - le faux Gemini refuse un schéma dont `required` ou `propertyOrdering`
 *     citent une propriété inexistante (HTTP 400, comme le vrai) ;
 *   - une horloge simulée avance à chaque appel réseau et à chaque pause, pour
 *     que les budgets de temps se testent sans attendre.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TAILLE_MAX_PROPRIETE = 9 * 1024;
const EST_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const EST_NOMBRE = /^[+-]?(\d+([.,]\d+)?|\d*[.,]\d+)([eE][+-]?\d+)?$/;
const MIME_PDF = 'application/pdf';
const MIME_DOC = 'application/vnd.google-apps.document';

const octetsSignes = (buffer) => [...buffer].map((o) => (o > 127 ? o - 256 : o));
const octetsNonSignes = (octets) => Buffer.from(octets.map((o) => o & 0xff));

const colonneEnIndice = (lettres) => [...lettres].reduce((n, c) => (n * 26) + (c.charCodeAt(0) - 64), 0);

const installerFauxGoogle = (sandbox, { racine, DateContexte, options = {} }) => {
  const horloge = { decalage: 0 };
  const journal = {
    toasts: [], alertes: [], prompts: [], modales: [], barresLaterales: [], menus: [], logs: [],
    brouillons: [], courriels: [], requetesGemini: [], requetesWeb: [], pauses: 0, flushs: 0,
  };
  const reponsesUi = [];
  const reponsesPrompt = [];
  const verrou = { tenuAilleurs: false, tenu: false };
  const declencheurs = [];
  let compteurDeclencheurs = 0;

  const avancer = (ms) => { horloge.decalage += ms; };
  // Date.now() du bac à sable suit l'horloge simulée : c'est lui que lisent les budgets de temps.
  const nowReel = DateContexte.now.bind(DateContexte);
  const maintenant = () => nowReel() + horloge.decalage;
  DateContexte.now = maintenant;

  /* ------------------------------ Classeur ------------------------------ */

  const commeSheets = (valeur, format) => {
    if (valeur === null) return '';
    if (typeof valeur === 'string') {
      if (valeur.startsWith("'")) return { texte: valeur.slice(1) };
      if (valeur.startsWith('=')) return `#FORMULE(${valeur})`;
      if (format === '@') return valeur;
      if (/^[+\-@]/.test(valeur) && !EST_NOMBRE.test(valeur.trim())) return `#FORMULE(${valeur})`;
      if (EST_NOMBRE.test(valeur.trim())) return Number(valeur.trim().replace(',', '.'));
      if (EST_JOUR.test(valeur)) {
        const [a, m, j] = valeur.split('-').map(Number);
        return new DateContexte(a, m - 1, j);
      }
      return valeur;
    }
    if (Object.prototype.toString.call(valeur) === '[object Date]') return new DateContexte(valeur.getTime());
    return valeur;
  };

  class Cellule {
    constructor() {
      this.valeur = '';
      this.lien = null;
      this.format = null;
    }
  }

  class FaussePlage {
    constructor(feuille, ligne, colonne, hauteur, largeur) {
      if (hauteur < 1) throw new Error('The number of rows in the range must be at least 1.');
      if (largeur < 1) throw new Error('The number of columns in the range must be at least 1.');
      if (ligne < 1 || colonne < 1 || ligne + hauteur - 1 > feuille.maxLignes || colonne + largeur - 1 > feuille.maxColonnes) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      }
      Object.assign(this, { feuille, ligne, colonne, hauteur, largeur });
    }

    cellules(fn) {
      for (let l = 0; l < this.hauteur; l++) {
        for (let c = 0; c < this.largeur; c++) fn(this.feuille.cellule(this.ligne + l, this.colonne + c), l, c);
      }
      return this;
    }

    verifierDimensions(valeurs, quoi = 'data') {
      if (!Array.isArray(valeurs) || valeurs.length !== this.hauteur) {
        throw new Error(`The number of rows in the ${quoi} does not match the number of rows in the range. The ${quoi} has ${valeurs && valeurs.length} but the range has ${this.hauteur}.`);
      }
      valeurs.forEach((ligne) => {
        if (!Array.isArray(ligne) || ligne.length !== this.largeur) {
          throw new Error(`The number of columns in the ${quoi} does not match the number of columns in the range. The ${quoi} has ${ligne && ligne.length} but the range has ${this.largeur}.`);
        }
        ligne.forEach((v) => {
          if (v === undefined) throw new Error('Exception: Invalid argument: undefined');
        });
      });
    }

    getRow() { return this.ligne; }
    getColumn() { return this.colonne; }
    getNumRows() { return this.hauteur; }
    getNumColumns() { return this.largeur; }

    getValues() {
      const sortie = [];
      for (let l = 0; l < this.hauteur; l++) {
        const ligne = [];
        for (let c = 0; c < this.largeur; c++) {
          const cellule = this.feuille.lire(this.ligne + l, this.colonne + c);
          let v = cellule ? cellule.valeur : '';
          if (v && typeof v === 'object' && 'texte' in v) v = v.texte;
          if (Object.prototype.toString.call(v) === '[object Date]') v = new DateContexte(v.getTime());
          ligne.push(v);
        }
        sortie.push(ligne);
      }
      journal.cellulesLues = (journal.cellulesLues || 0) + (this.hauteur * this.largeur);
      return sortie;
    }

    setValues(valeurs) {
      this.verifierDimensions(valeurs);
      return this.cellules((cellule, l, c) => {
        cellule.valeur = commeSheets(valeurs[l][c], cellule.format);
        cellule.lien = null;
      });
    }

    setValue(valeur) {
      if (valeur === undefined) throw new Error('Exception: Invalid argument: value');
      return this.setValues(Array.from({ length: this.hauteur }, () => Array.from({ length: this.largeur }, () => valeur)));
    }

    getRichTextValue() {
      const cellule = this.feuille.lire(this.ligne, this.colonne);
      const texte = cellule ? String(cellule.valeur && cellule.valeur.texte !== undefined ? cellule.valeur.texte : cellule.valeur) : '';
      return { getText: () => texte, getLinkUrl: () => (cellule ? cellule.lien : null) };
    }

    setRichTextValues(valeurs) {
      this.verifierDimensions(valeurs, 'rich text values');
      return this.cellules((cellule, l, c) => {
        const rt = valeurs[l][c];
        if (!rt || rt.__richText !== true) throw new Error('Exception: Invalid argument: values');
        cellule.valeur = { texte: rt.texte };
        cellule.lien = rt.lien;
      });
    }

    setNumberFormat(format) {
      if (typeof format !== 'string') throw new Error('Exception: Invalid argument: numberFormat');
      return this.cellules((cellule) => { cellule.format = format; });
    }

    setNotes(notes) {
      this.verifierDimensions(notes, 'notes');
      return this;
    }

    setDataValidation(regle) {
      if (regle !== null && (!regle || regle.__validation !== true)) throw new Error('Exception: Invalid argument: rule');
      return this;
    }

    sort(spec) {
      const specs = (Array.isArray(spec) ? spec : [spec]).map((s) => (typeof s === 'number' ? { column: s, ascending: true } : s));
      specs.forEach((s) => {
        if (s.column < this.colonne || s.column > this.colonne + this.largeur - 1) {
          throw new Error('The sort column must be within the range.');
        }
      });
      const lignes = [];
      for (let l = 0; l < this.hauteur; l++) {
        const cellules = [];
        for (let c = 0; c < this.largeur; c++) cellules.push(this.feuille.cellule(this.ligne + l, this.colonne + c));
        lignes.push(cellules);
      }
      const cle = (cellules, colonne) => {
        const v = cellules[colonne - this.colonne].valeur;
        return v && typeof v === 'object' && 'texte' in v ? v.texte : v;
      };
      const comparer = (a, b) => {
        if (a === b) return 0;
        if (a === '') return 1;
        if (b === '') return -1;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'number') return -1;
        if (typeof b === 'number') return 1;
        return String(a).localeCompare(String(b), 'fr');
      };
      lignes.sort((x, y) => {
        for (const s of specs) {
          const r = comparer(cle(x, s.column), cle(y, s.column));
          if (r !== 0) return s.ascending === false ? -r : r;
        }
        return 0;
      });
      lignes.forEach((cellules, l) => {
        cellules.forEach((cellule, c) => { this.feuille.lignes[this.ligne - 1 + l][this.colonne - 1 + c] = cellule; });
      });
      journal.tris = (journal.tris || 0) + 1;
      return this;
    }

    merge() { return this; }
    setFontFamily() { return this; }
    setFontSize() { return this; }
    setFontWeight() { return this; }
    setFontStyle() { return this; }
    setFontColor(couleur) {
      if (typeof couleur !== 'string') throw new Error('Exception: Invalid argument: color');
      return this;
    }
    setFontColors(couleurs) {
      this.verifierDimensions(couleurs, 'colors');
      couleurs.forEach((ligne) => ligne.forEach((c) => {
        if (typeof c !== 'string') throw new Error('Exception: Invalid argument: colors');
      }));
      return this.cellules((cellule, l, c) => { cellule.encre = couleurs[l][c]; });
    }
    setBackground(couleur) {
      if (typeof couleur !== 'string') throw new Error('Exception: Invalid argument: color');
      return this;
    }
    setHorizontalAlignment() { return this; }
    setVerticalAlignment() { return this; }
    setWrap() { return this; }
    setBorder() { return this; }
    clearDataValidations() { return this; }
    applyRowBanding() { return { remove: () => {} }; }
    protect() {
      const protection = { setDescription: () => protection, setWarningOnly: () => protection, remove: () => {} };
      return protection;
    }
    activate() { return this; }
  }

  class FausseFeuille {
    constructor(classeur, nom) {
      Object.assign(this, { classeur, nom, lignes: [], maxLignes: 1000, maxColonnes: 26, masquees: new Set() });
    }

    cellule(l, c) {
      while (this.lignes.length < l) this.lignes.push([]);
      const ligne = this.lignes[l - 1];
      while (ligne.length < c) ligne.push(new Cellule());
      return ligne[c - 1];
    }

    lire(l, c) {
      const ligne = this.lignes[l - 1];
      return ligne ? ligne[c - 1] : undefined;
    }

    getName() { return this.nom; }
    getSheetName() { return this.nom; }

    getLastRow() {
      for (let l = this.lignes.length; l >= 1; l--) {
        if (this.lignes[l - 1].some((c) => c.valeur !== '')) return l;
      }
      return 0;
    }

    getLastColumn() {
      let max = 0;
      this.lignes.forEach((ligne) => ligne.forEach((c, i) => { if (c.valeur !== '') max = Math.max(max, i + 1); }));
      return max;
    }

    getMaxRows() { return this.maxLignes; }
    getMaxColumns() { return this.maxColonnes; }

    insertColumnsAfter(apres, nombre) {
      if (apres < 1 || apres > this.maxColonnes) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      this.lignes.forEach((ligne) => {
        while (ligne.length < apres) ligne.push(new Cellule());
        ligne.splice(apres, 0, ...Array.from({ length: nombre }, () => new Cellule()));
      });
      this.maxColonnes += nombre;
      return this;
    }

    /** Insertion par l'équipe RH d'une colonne à la main, pour les cas de banc. */
    insererColonneAvant(avant) {
      this.lignes.forEach((ligne) => {
        while (ligne.length < avant - 1) ligne.push(new Cellule());
        ligne.splice(avant - 1, 0, new Cellule());
      });
      this.maxColonnes += 1;
    }

    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
        if (!m) throw new Error(`Range not found: ${a}`);
        const col1 = colonneEnIndice(m[1]);
        const lig1 = m[2] ? Number(m[2]) : 1;
        const col2 = m[3] ? colonneEnIndice(m[3]) : col1;
        const lig2 = m[3] ? (m[4] ? Number(m[4]) : this.maxLignes) : lig1;
        return new FaussePlage(this, lig1, col1, lig2 - lig1 + 1, col2 - col1 + 1);
      }
      if ([a, b].some((v) => typeof v !== 'number' || Number.isNaN(v))) throw new Error('Exception: Invalid argument: row');
      return new FaussePlage(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
    }

    // Comme le vrai : « the selected range in the active sheet », quel que soit
    // l'onglet sur lequel on l'appelle. Un faux qui filtrerait par onglet
    // masquerait la lecture d'une sélection faite ailleurs.
    getActiveRange() { return this.classeur.selection; }
    setFrozenRows() { return this; }
    setRowHeight() { return this; }
    setColumnWidth() { return this; }
    hideColumns(col, n = 1) { for (let i = 0; i < n; i++) this.masquees.add(col + i); return this; }
    showColumns(col, n = 1) { for (let i = 0; i < n; i++) this.masquees.delete(col + i); return this; }
    setHiddenGridlines() { return this; }
    clear() { this.lignes = []; return this; }
    clearConditionalFormatRules() { return this; }
    getProtections() { return []; }
    getBandings() { return []; }
    getConditionalFormatRules() { return []; }
    setConditionalFormatRules(regles) {
      if (!Array.isArray(regles) || regles.some((r) => !r || r.__regle !== true)) throw new Error('Exception: Invalid argument: rules');
      return this;
    }
    deleteRows(debut, nombre) { this.lignes.splice(debut - 1, nombre); return this; }
    appendRow(valeurs) {
      const l = this.getLastRow() + 1;
      this.getRange(l, 1, 1, valeurs.length).setValues([valeurs]);
      return this;
    }
    activate() { this.classeur.active = this; return this; }
  }

  const classeur = {
    feuilles: [],
    active: null,
    selection: null,
    getSheetByName(nom) { return this.feuilles.find((f) => f.nom === nom) || null; },
    getSheets() { return [...this.feuilles]; },
    insertSheet(nom, index) {
      if (this.getSheetByName(nom)) throw new Error(`A sheet with the name "${nom}" already exists. Please enter another name.`);
      const feuille = new FausseFeuille(this, nom);
      if (typeof index === 'number') this.feuilles.splice(index, 0, feuille);
      else this.feuilles.push(feuille);
      this.active = feuille;
      return feuille;
    },
    deleteSheet(feuille) { this.feuilles = this.feuilles.filter((f) => f !== feuille); },
    setActiveSheet(feuille) { this.active = feuille; return feuille; },
    getActiveSheet() { return this.active || this.feuilles[0]; },
    toast(message, titre) { journal.toasts.push({ message, titre }); },
  };

  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    alert(a, b, c) {
      const entree = c === undefined && b === undefined ? { message: a } : { titre: a, message: b, boutons: c };
      journal.alertes.push(entree);
      if (!entree.boutons || entree.boutons === 'OK') return 'OK';
      return reponsesUi.length > 0 ? reponsesUi.shift() : 'YES';
    },
    prompt(titre, message) {
      const reponse = reponsesPrompt.shift() || { bouton: 'CANCEL', texte: '' };
      journal.prompts.push({ titre, message });
      return { getSelectedButton: () => reponse.bouton, getResponseText: () => reponse.texte };
    },
    createMenu(titre) {
      if (typeof titre !== 'string' || titre === '') throw new Error('Invalid argument: caption');
      const menu = { titre, entrees: [] };
      const constructeur = {
        addItem: (libelle, fonction) => { menu.entrees.push({ libelle, fonction }); return constructeur; },
        addSeparator: () => constructeur,
        addToUi: () => { journal.menus.push(menu); },
      };
      return constructeur;
    },
    showSidebar(sortie) { journal.barresLaterales.push(sortie); },
    showModalDialog(sortie, titre) {
      if (!sortie || typeof sortie.getContent !== 'function') throw new Error('Exception: Invalid argument: userInterface');
      journal.modales.push({ titre, html: sortie.getContent() });
    },
  };

  const nouveauBuilder = (fabrique) => {
    const etat = {};
    const builder = new Proxy({}, {
      get: (cible, nom) => {
        if (nom === 'build') return () => fabrique(etat);
        return (...args) => { etat[nom] = args; return builder; };
      },
    });
    return builder;
  };

  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet: () => classeur,
    getActive: () => classeur,
    getActiveSheet: () => classeur.getActiveSheet(),
    getUi: () => ui,
    flush: () => { journal.flushs++; },
    newRichTextValue: () => {
      const rt = { __richText: true, texte: null, lien: null };
      const builder = {
        setText: (texte) => {
          if (typeof texte !== 'string') throw new Error('Exception: Invalid argument: text');
          rt.texte = texte;
          return builder;
        },
        setLinkUrl: (lien) => { rt.lien = lien; return builder; },
        build: () => {
          if (rt.texte === null) throw new Error('Exception: text must be set');
          return rt;
        },
      };
      return builder;
    },
    newDataValidation: () => nouveauBuilder((etat) => ({ __validation: true, etat })),
    newConditionalFormatRule: () => nouveauBuilder((etat) => ({ __regle: true, etat })),
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
    BorderStyle: { SOLID: 'SOLID' },
    ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
  };

  /* ------------------------------ Propriétés ------------------------------ */

  const magasin = () => {
    const donnees = new Map();
    const verifier = (cle, valeur) => {
      if (typeof cle !== 'string' || cle === '') throw new Error('Exception: Invalid argument: key');
      if (Buffer.byteLength(String(valeur), 'utf8') > TAILLE_MAX_PROPRIETE) throw new Error('Exception: Argument too large: value');
    };
    return {
      donnees,
      getProperty: (cle) => (donnees.has(cle) ? donnees.get(cle) : null),
      getProperties: () => Object.fromEntries(donnees),
      setProperty(cle, valeur) { verifier(cle, valeur); donnees.set(cle, String(valeur)); return this; },
      setProperties(objet) {
        Object.entries(objet).forEach(([cle, valeur]) => verifier(cle, valeur));
        Object.entries(objet).forEach(([cle, valeur]) => donnees.set(cle, String(valeur)));
        return this;
      },
      deleteProperty(cle) { donnees.delete(cle); return this; },
    };
  };
  const proprietes = { script: magasin(), document: magasin(), utilisateur: magasin() };
  sandbox.PropertiesService = {
    getScriptProperties: () => proprietes.script,
    getDocumentProperties: () => proprietes.document,
    getUserProperties: () => proprietes.utilisateur,
  };

  sandbox.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        if (verrou.tenuAilleurs || verrou.tenu) return false;
        verrou.tenu = true;
        return true;
      },
      hasLock: () => verrou.tenu,
      releaseLock: () => { verrou.tenu = false; },
    }),
  };

  /* ------------------------------ Utilitaires ------------------------------ */

  sandbox.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (algo, texte, charset) => {
      if (algo !== 'SHA_256') throw new Error('Exception: Invalid argument: algorithm');
      if (charset !== 'UTF_8') throw new Error('Exception: Invalid argument: charset');
      return octetsSignes(crypto.createHash('sha256').update(String(texte), 'utf8').digest());
    },
    sleep: (ms) => { journal.pauses += ms; avancer(ms); },
    base64Encode: (octets) => octetsNonSignes(octets).toString('base64'),
    newBlob: (donnees) => ({ getBytes: () => octetsSignes(Buffer.from(String(donnees), 'utf8')) }),
    formatDate: (date, fuseau, motif) => {
      if (motif !== 'yyyy-MM-dd') throw new Error(`Motif non simulé : ${motif}`);
      return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    },
  };

  sandbox.Session = {
    getActiveUser: () => ({ getEmail: () => options.utilisateur || 'rh@exemple.fr' }),
    getEffectiveUser: () => ({ getEmail: () => options.utilisateur || 'rh@exemple.fr' }),
    getActiveUserLocale: () => {
      if (options.localeIndisponible) throw new Error('Exception: You do not have permission to call Session.getActiveUserLocale');
      return options.langue || 'fr';
    },
    getScriptTimeZone: () => 'Europe/Paris',
  };

  sandbox.Logger = { log: (message) => { journal.logs.push(String(message)); } };

  sandbox.ScriptApp = {
    getProjectTriggers: () => [...declencheurs],
    deleteTrigger: (declencheur) => {
      const i = declencheurs.indexOf(declencheur);
      if (i === -1) throw new Error('Exception: Invalid argument: trigger');
      declencheurs.splice(i, 1);
    },
    newTrigger: (fonction) => {
      if (typeof fonction !== 'string' || fonction === '') throw new Error('Exception: Invalid argument: functionName');
      const d = { fonction, type: null };
      const creer = () => {
        compteurDeclencheurs++;
        if (declencheurs.length >= 20) throw new Error('This script has too many triggers. Triggers must be deleted from the script before more can be added.');
        const declencheur = { getHandlerFunction: () => fonction, getUniqueId: () => `d${compteurDeclencheurs}`, d };
        declencheurs.push(declencheur);
        return declencheur;
      };
      return {
        timeBased: () => ({
          after: (ms) => { d.type = 'apres'; d.ms = ms; return { create: creer }; },
          everyDays: (n) => { d.type = 'quotidien'; d.n = n; return { atHour: (h) => { d.heure = h; return { create: creer }; } }; },
        }),
      };
    },
  };

  /* ------------------------------ Drive ------------------------------ */

  const fichiers = new Map();
  const dossiers = new Map();
  const introuvable = () => new Error('Exception: No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it.');

  const fauxFichier = (spec) => {
    const fichier = {
      spec,
      corbeille: false,
      getId: () => spec.id,
      getName: () => spec.nom,
      getMimeType: () => spec.mime,
      getSize: () => (spec.mime === MIME_DOC ? 0 : Buffer.byteLength(spec.contenu, 'utf8')),
      getUrl: () => `https://drive.google.com/file/d/${spec.id}/view`,
      getDateCreated: () => new DateContexte(spec.cree || Date.now()),
      getLastUpdated: () => new DateContexte(spec.cree || Date.now()),
      getBlob: () => ({
        getBytes: () => octetsSignes(Buffer.from(spec.contenu, 'utf8')),
        getAs: (mime) => {
          if (mime !== MIME_PDF) throw new Error(`Conversion non simulée : ${mime}`);
          return { getBytes: () => octetsSignes(Buffer.from(spec.contenu, 'utf8')) };
        },
      }),
      getAs: (mime) => fichier.getBlob().getAs(mime),
      setTrashed: (valeur) => { fichier.corbeille = Boolean(valeur); return fichier; },
      isTrashed: () => fichier.corbeille,
    };
    return fichier;
  };

  sandbox.MimeType = { PDF: MIME_PDF, GOOGLE_DOCS: MIME_DOC };

  sandbox.DriveApp = {
    getFolderById: (id) => {
      const dossier = dossiers.get(id);
      if (!dossier) throw introuvable();
      return {
        getId: () => id,
        getFiles: () => {
          const liste = dossier.ids.map((i) => fichiers.get(i)).filter((f) => f && !f.corbeille);
          let rang = 0;
          return { hasNext: () => rang < liste.length, next: () => liste[rang++] };
        },
      };
    },
    getFileById: (id) => {
      const fichier = fichiers.get(id);
      if (!fichier) throw introuvable();
      return fichier;
    },
  };

  sandbox.Drive = {
    Files: {
      copy: (ressource, id, opts) => {
        const source = fichiers.get(id);
        if (!source) throw introuvable();
        if (!opts || opts.convert !== true) throw new Error('Conversion attendue');
        const copie = fauxFichier({ id: `tmp-${id}`, nom: ressource.title, mime: MIME_DOC, contenu: source.spec.contenu });
        fichiers.set(copie.getId(), copie);
        return { id: copie.getId() };
      },
      remove: (id) => { fichiers.delete(id); },
    },
  };

  /* ------------------------------ Gemini ------------------------------ */

  const verifierSchema = (schema, chemin = 'schema') => {
    if (!schema || typeof schema.type !== 'string') return `${chemin}.type manquant`;
    if (schema.type === 'OBJECT') {
      const proprietes = Object.keys(schema.properties || {});
      for (const r of schema.required || []) if (!proprietes.includes(r)) return `${chemin}.required cite « ${r} » absent des propriétés`;
      for (const r of schema.propertyOrdering || []) if (!proprietes.includes(r)) return `${chemin}.propertyOrdering cite « ${r} » absent des propriétés`;
      for (const p of proprietes) {
        const erreur = verifierSchema(schema.properties[p], `${chemin}.${p}`);
        if (erreur) return erreur;
      }
    }
    if (schema.type === 'ARRAY') return verifierSchema(schema.items, `${chemin}.items`);
    if (schema.enum && !schema.enum.every((v) => typeof v === 'string')) return `${chemin}.enum non textuel`;
    return null;
  };

  const reponseTexte = (texte, finishReason = 'STOP') => ({
    code: 200, corps: JSON.stringify({ candidates: [{ content: { parts: [{ text: texte }] }, finishReason }] }),
  });

  const fauxGemini = (url, params) => {
    avancer(options.msParAppelGemini || 3000);
    if (!params.headers || !params.headers['x-goog-api-key']) return { code: 403, corps: JSON.stringify({ error: { message: 'Missing API key' } }) };
    const payload = JSON.parse(params.payload);
    const modele = (url.match(/models\/([^:]+):generateContent/) || [])[1];
    const parts = payload.contents[0].parts;
    const textes = parts.filter((p) => p.text).map((p) => p.text);
    const doc = parts.find((p) => p.inlineData);
    const schema = payload.generationConfig && payload.generationConfig.responseSchema;
    const entree = { modele, textes, schema: schema || null, doc: null };
    journal.requetesGemini.push(entree);

    if (schema) {
      const erreur = verifierSchema(schema);
      if (erreur) return { code: 400, corps: JSON.stringify({ error: { message: `Invalid JSON payload: ${erreur}` } }) };
    }

    if (schema && schema.properties && schema.properties.criteres && schema.properties.criteres.type === 'OBJECT') {
      const profil = JSON.parse(Buffer.from(doc.inlineData.data, 'base64').toString('utf8'));
      entree.doc = profil;
      if (profil.http) return { code: profil.http, corps: JSON.stringify({ error: { message: `Erreur simulée ${profil.http}` } }) };
      const codes = schema.properties.criteres.required;
      const criteres = {};
      codes.forEach((code) => {
        const texte = schema.properties.criteres.properties[code].description.replace(/^Critère C\d+ : /, '');
        const statut = (profil.criteres || {})[texte] || 'Non démontré';
        if (profil.oublier && profil.oublier.includes(texte)) return;
        criteres[code] = { statut, preuve: statut === 'Non démontré' ? '' : `Extrait du CV sur ${texte}` };
      });
      const reponse = {
        candidateName: profil.nom,
        email: profil.email || 'Non renseigné',
        phone: profil.telephone || 'Non renseigné',
        criteres,
        experience: profil.experience || 'Expérience décrite dans le CV.',
        education: 'Formation décrite dans le CV.',
        strengths: profil.forces || 'Points forts du profil.',
        weaknesses: 'Points à creuser en entretien.',
      };
      return reponseTexte(JSON.stringify(reponse), profil.finishReason || 'STOP');
    }

    if (schema && schema.properties && schema.properties.criteres && schema.properties.criteres.type === 'ARRAY') {
      return reponseTexte(JSON.stringify({ criteres: options.grilleProposee || [] }));
    }

    const prompt = textes.join('\n');
    if (prompt.includes('Rédige un email')) return reponseTexte('Bonjour,\n\nMerci pour votre candidature.');
    if (prompt.includes('résumé des candidats')) return reponseTexte('Concentrez les entretiens sur les profils les mieux notés.');
    return reponseTexte('Titre du poste : développeur. Missions : développer. Profil : Python exigé.');
  };

  const reponseHttp = ({ code, corps }) => ({ getResponseCode: () => code, getContentText: () => corps });

  const fetchUn = (url, params = {}) => {
    let resultat;
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      resultat = fauxGemini(url, params);
    } else {
      avancer(500);
      journal.requetesWeb.push(url);
      const page = (options.pagesWeb || {})[url];
      resultat = page || { code: 404, corps: 'Introuvable' };
    }
    if (resultat.code >= 400 && params.muteHttpExceptions !== true) {
      throw new Error(`Exception: Request failed for ${url} returned code ${resultat.code}. Truncated server response: ${resultat.corps.slice(0, 50)}`);
    }
    return reponseHttp(resultat);
  };

  sandbox.UrlFetchApp = {
    fetch: (url, params) => fetchUn(url, params),
    fetchAll: (requetes) => requetes.map((r) => fetchUn(r.url, r)),
  };

  sandbox.MailApp = {
    sendEmail: (message) => {
      if (!message || typeof message.to !== 'string') throw new Error('Exception: Invalid argument: recipient');
      journal.courriels.push(message);
    },
  };

  sandbox.GmailApp = {
    createDraft: (destinataire, sujet, corps) => {
      if (typeof destinataire !== 'string' || !destinataire.includes('@')) throw new Error('Exception: Invalid argument: recipient');
      if (typeof sujet !== 'string' || typeof corps !== 'string') throw new Error('Exception: Invalid argument');
      avancer(1000);
      journal.brouillons.push({ destinataire, sujet, corps });
      return {};
    },
  };

  const sortieHtml = (html) => {
    const sortie = {
      getContent: () => html,
      setTitle: () => sortie,
      setWidth: () => sortie,
      setHeight: () => sortie,
    };
    return sortie;
  };
  sandbox.HtmlService = {
    createHtmlOutputFromFile: (nom) => {
      const chemin = path.join(racine, `${nom}.html`);
      if (!fs.existsSync(chemin)) throw new Error(`Exception: No HTML file named ${nom} was found.`);
      return sortieHtml(fs.readFileSync(chemin, 'utf8'));
    },
    createHtmlOutput: (html) => sortieHtml(String(html)),
  };

  return {
    horloge,
    avancer,
    maintenant,
    journal,
    classeur,
    proprietes,
    verrou,
    declencheurs,
    fichiers,
    dossiers,
    repondre: (...reponses) => { reponsesUi.push(...reponses); },
    repondrePrompt: (bouton, texte) => { reponsesPrompt.push({ bouton, texte }); },
    ajouterDossier: (id, specs) => {
      specs.forEach((spec) => fichiers.set(spec.id, fauxFichier(spec)));
      dossiers.set(id, { ids: specs.map((s) => s.id) });
    },
    ajouterAuDossier: (id, spec) => {
      fichiers.set(spec.id, fauxFichier(spec));
      dossiers.get(id).ids.push(spec.id);
    },
    selectionner: (feuille, ligne) => {
      classeur.active = feuille;
      classeur.selection = feuille.getRange(ligne, 1);
    },
  };
};

module.exports = { installerFauxGoogle, MIME_PDF, MIME_DOC };
