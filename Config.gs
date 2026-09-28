/**
 * Config.gs
 * Lecture et sauvegarde de la configuration dans PropertiesService.getDocumentProperties().
 *
 * Le magasin « document » est partagé par toute l'équipe qui travaille sur le
 * classeur : c'est voulu, les réglages décrivent le recrutement, pas la
 * personne. La clé API, elle, vit dans le magasin « script » (voir saveApiKey).
 */

/**
 * @typedef {Object} Config
 * @property {string} folderUrl       URL du dossier Drive des CV
 * @property {string} jobDescription  Texte de l'annonce, ou son URL
 * @property {string} model           Modèle Gemini
 * @property {string} accountType     « Gratuit (Free tier) » ou « Payant (Pay-as-you-go) »
 * @property {string} criteria        Consignes d'évaluation libres de l'équipe RH
 * @property {string} systemPrompt    Prompt personnalisé ; vide = prompt par défaut
 * @property {number} retentionDays   Délai de rétention RGPD, en jours
 * @property {string} allowedDomains  Domaines d'annonce autorisés, séparés par des virgules
 * @property {number} seuilContact    Score minimal pour « À contacter »
 * @property {number} seuilVivier     Score minimal pour « À garder en vivier »
 * @property {number} placesContact   Nombre maximal de candidats « À contacter »
 */

/**
 * Lit toutes les valeurs de configuration stockées dans DocumentProperties.
 * Assure une migration transparente si une ancienne feuille "Configuration" existe.
 * @returns {Config}
 */
function getConfig() {
  const docProps = PropertiesService.getDocumentProperties();
  let props = docProps.getProperties();

  // Migration automatique si DocumentProperties est vide et qu'une ancienne feuille existe
  if (Object.keys(props).length === 0) {
    _migrateLegacyConfigSheet(docProps);
    props = docProps.getProperties();
  }

  const entier = (cle, defaut) => {
    const brut = props[cle];
    if (brut === undefined || brut === '') return defaut;
    const n = Number(brut);
    return Number.isFinite(n) ? Math.round(n) : defaut;
  };

  return {
    folderUrl: props[PROP_KEYS.FOLDER_URL] || '',
    jobDescription: props[PROP_KEYS.JOB_DESCRIPTION] || '',
    model: props[PROP_KEYS.MODEL] || MODELE_PAR_DEFAUT,
    accountType: props[PROP_KEYS.ACCOUNT_TYPE] || 'Gratuit (Free tier)',
    criteria: props[PROP_KEYS.CRITERIA] || '',
    systemPrompt: estPromptParDefaut_(props[PROP_KEYS.SYSTEM_PROMPT]) ? '' : props[PROP_KEYS.SYSTEM_PROMPT],
    retentionDays: entier(PROP_KEYS.RETENTION_DAYS, 730),
    allowedDomains: props[PROP_KEYS.ALLOWED_DOMAINS] || DEFAULT_ALLOWED_DOMAINS.join(', '),
    seuilContact: entier(PROP_KEYS.SEUIL_CONTACT, REGLAGES_SELECTION_DEFAUT.seuilContact),
    seuilVivier: entier(PROP_KEYS.SEUIL_VIVIER, REGLAGES_SELECTION_DEFAUT.seuilVivier),
    placesContact: entier(PROP_KEYS.PLACES_CONTACT, REGLAGES_SELECTION_DEFAUT.placesContact),
  };
}

/**
 * Un prompt stocké vaut-il « prompt par défaut » ?
 *
 * Vide, identique au défaut courant, ou identique à l'un des défauts des
 * versions antérieures que l'ancien panneau figeait dans les réglages (voir
 * EMPREINTES_PROMPTS_HISTORIQUES). Un prompt retouché à la main n'en est pas un.
 */
const estPromptParDefaut_ = (prompt) => {
  const normalise = normaliserEspaces_(prompt);
  if (normalise === '' || normalise === normaliserEspaces_(DEFAULT_PROMPT)) return true;
  return EMPREINTES_PROMPTS_HISTORIQUES.includes(empreinteTexte_(normalise).substring(0, 16));
};

/** Un prompt personnalisé n'est utilisable que s'il porte les deux emplacements. */
const promptEstUtilisable_ = (prompt) => String(prompt).includes('{{JOB_DESCRIPTION}}')
  && String(prompt).includes('{{CRITERIA}}');

/**
 * Valide les réglages de sélection et rend un message qui dit quoi corriger,
 * ou `null` s'ils sont cohérents.
 */
const verifierReglagesSelection_ = ({ seuilContact, seuilVivier, placesContact }) => {
  const entierEntre = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (!entierEntre(seuilContact, 0, 100)) return 'Le seuil « À contacter » doit être un entier entre 0 et 100.';
  if (!entierEntre(seuilVivier, 0, 100)) return 'Le seuil « Vivier » doit être un entier entre 0 et 100.';
  if (seuilVivier > seuilContact) {
    return `Le seuil « Vivier » (${seuilVivier}) dépasse le seuil « À contacter » (${seuilContact}) : aucun candidat ne pourrait être gardé en vivier.`;
  }
  if (!entierEntre(placesContact, 1, 100)) return 'Le nombre de places « À contacter » doit être un entier entre 1 et 100.';
  return null;
};

/** Taille en octets UTF-8 d'une chaîne : c'est elle que borne PropertiesService, pas sa longueur. */
const tailleOctets_ = (texte) => Utilities.newBlob(String(texte)).getBytes().length;

/**
 * Enregistre les modifications de configuration dans DocumentProperties.
 * @param {Object} configData
 * @returns {{ok: boolean, message: string}}
 */
function saveConfig(configData) {
  if (!configData || typeof configData !== 'object') {
    return { ok: false, message: 'Données de configuration invalides.' };
  }

  try {
    const docProps = PropertiesService.getDocumentProperties();
    const actuelle = getConfig();
    const updates = {};
    const texte = (v) => String(v ?? '').trim();

    if (configData.folderUrl !== undefined) updates[PROP_KEYS.FOLDER_URL] = texte(configData.folderUrl);
    if (configData.jobDescription !== undefined) updates[PROP_KEYS.JOB_DESCRIPTION] = texte(configData.jobDescription);
    if (configData.model !== undefined) updates[PROP_KEYS.MODEL] = texte(configData.model);
    if (configData.accountType !== undefined) updates[PROP_KEYS.ACCOUNT_TYPE] = texte(configData.accountType);
    if (configData.criteria !== undefined) updates[PROP_KEYS.CRITERIA] = texte(configData.criteria);
    if (configData.retentionDays !== undefined) updates[PROP_KEYS.RETENTION_DAYS] = String(Number(configData.retentionDays) || 730);
    if (configData.allowedDomains !== undefined) updates[PROP_KEYS.ALLOWED_DOMAINS] = texte(configData.allowedDomains);

    if (configData.systemPrompt !== undefined) {
      const prompt = texte(configData.systemPrompt);
      if (estPromptParDefaut_(prompt)) {
        // Le défaut ne se stocke pas : il doit pouvoir évoluer avec le code.
        updates[PROP_KEYS.SYSTEM_PROMPT] = '';
      } else if (!promptEstUtilisable_(prompt)) {
        return {
          ok: false,
          message: 'Le prompt personnalisé doit contenir {{JOB_DESCRIPTION}} et {{CRITERIA}}. Videz le champ pour revenir au prompt par défaut.',
        };
      } else {
        updates[PROP_KEYS.SYSTEM_PROMPT] = prompt;
      }
    }

    const reglages = {
      seuilContact: configData.seuilContact !== undefined ? Number(configData.seuilContact) : actuelle.seuilContact,
      seuilVivier: configData.seuilVivier !== undefined ? Number(configData.seuilVivier) : actuelle.seuilVivier,
      placesContact: configData.placesContact !== undefined ? Number(configData.placesContact) : actuelle.placesContact,
    };
    const erreurReglages = verifierReglagesSelection_(reglages);
    if (erreurReglages) return { ok: false, message: erreurReglages };
    updates[PROP_KEYS.SEUIL_CONTACT] = String(reglages.seuilContact);
    updates[PROP_KEYS.SEUIL_VIVIER] = String(reglages.seuilVivier);
    updates[PROP_KEYS.PLACES_CONTACT] = String(reglages.placesContact);

    const tropGrande = Object.keys(updates).find((cle) => tailleOctets_(updates[cle]) > TAILLE_MAX_PROPRIETE);
    if (tropGrande) {
      const ko = Math.ceil(tailleOctets_(updates[tropGrande]) / 1024);
      const quoi = tropGrande === PROP_KEYS.JOB_DESCRIPTION ? "L'annonce" : 'Un réglage';
      return {
        ok: false,
        message: `${quoi} fait ${ko} Ko : c'est au-delà des 9 Ko que Google accepte par réglage. Retirez la présentation de l'entreprise et les avantages, qui n'aident pas l'évaluation, ou indiquez plutôt l'URL de l'annonce.`,
      };
    }

    docProps.setProperties(updates);
    return { ok: true, message: 'Configuration enregistrée avec succès.' };
  } catch (e) {
    return { ok: false, message: `Erreur de sauvegarde de la configuration : ${e.message}` };
  }
}

/**
 * Migre les données d'une ancienne feuille "Configuration" vers DocumentProperties.
 * @private
 */
function _migrateLegacyConfigSheet(docProps) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const legacySheet = ss ? ss.getSheetByName(LEGACY_CONFIG_SHEET_NAME) : null;
    if (!legacySheet) return;

    const data = legacySheet.getRange('A:B').getValues();
    const mapping = {
      'URL du dossier Drive contenant les CVs': PROP_KEYS.FOLDER_URL,
      "URL ou texte de l'annonce": PROP_KEYS.JOB_DESCRIPTION,
      'Modèle Gemini': PROP_KEYS.MODEL,
      'Type de compte Gemini': PROP_KEYS.ACCOUNT_TYPE,
      'Critères spécifiques du recruteur': PROP_KEYS.CRITERIA,
      'Prompt système': PROP_KEYS.SYSTEM_PROMPT,
      'Délai de rétention RGPD (jours)': PROP_KEYS.RETENTION_DAYS,
      'Domaines autorisés': PROP_KEYS.ALLOWED_DOMAINS,
    };

    const toSet = {};
    data.forEach((row) => {
      const label = (row[0] || '').toString().trim();
      const val = (row[1] || '').toString().trim();
      if (mapping[label] && val) {
        toSet[mapping[label]] = val;
      }
    });

    if (Object.keys(toSet).length > 0) {
      docProps.setProperties(toSet);
      Logger.log('Migration de l\'ancienne feuille Configuration effectuée avec succès.');
    }
  } catch (e) {
    Logger.log(`Erreur lors de la migration de l'ancienne feuille : ${e.message}`);
  }
}

/**
 * Prompt réellement envoyé à Gemini : le prompt personnalisé s'il est
 * utilisable, le prompt par défaut sinon. Rend aussi `ignore: true` quand un
 * prompt personnalisé a été écarté, pour que l'interface puisse le dire.
 */
const promptEffectif_ = (config) => {
  const personnalise = String(config.systemPrompt || '').trim();
  if (personnalise === '') return { prompt: DEFAULT_PROMPT, personnalise: false, ignore: false };
  if (!promptEstUtilisable_(personnalise)) return { prompt: DEFAULT_PROMPT, personnalise: false, ignore: true };
  return { prompt: personnalise, personnalise: true, ignore: false };
};

/**
 * Texte de l'annonce qui sert de référence à l'évaluation.
 *
 * Une annonce donnée par URL est lue puis résumée par Gemini **une seule
 * fois**, et le résultat est mémorisé. Avant la v1.0, cette extraction était
 * refaite à chaque exécution — y compris à chaque reprise automatique toutes
 * les cinq minutes —, et les CV d'une même campagne étaient comparés à des
 * résumés légèrement différents de la même annonce.
 */
const annonceDeReference_ = (config, apiKey, model, canUseUi) => {
  const source = String(config.jobDescription || '').trim();
  if (!source.startsWith('http://') && !source.startsWith('https://')) return source;

  const docProps = PropertiesService.getDocumentProperties();
  try {
    const memo = JSON.parse(docProps.getProperty(PROP_KEYS.ANNONCE_EXTRAITE) || 'null');
    if (memo && memo.source === source && memo.texte) return memo.texte;
  } catch (e) {
    Logger.log(`Annonce mémorisée illisible, relecture : ${e.message}`);
  }

  if (canUseUi) SpreadsheetApp.getActiveSpreadsheet().toast("Lecture de l'annonce...", 'Annonce 📄');
  const texte = extractJobDescriptionWithGemini(fetchJobDescription(source, config.allowedDomains), apiKey, model);
  const memo = JSON.stringify({ source, texte });
  if (tailleOctets_(memo) <= TAILLE_MAX_PROPRIETE) {
    docProps.setProperty(PROP_KEYS.ANNONCE_EXTRAITE, memo);
  } else {
    // Sans mémo, la relecture a lieu à chaque exécution : c'est le comportement
    // d'avant la v1.0, moins stable mais correct. On le trace pour le savoir.
    Logger.log(`Annonce extraite trop longue pour être mémorisée (${tailleOctets_(memo)} octets).`);
  }
  return texte;
};

/**
 * Enregistre la clé API Gemini de manière sécurisée dans ScriptProperties.
 * @param {string} key
 * @returns {{ok: boolean, message?: string}}
 */
function saveApiKey(key) {
  const trimmedKey = (key || '').trim();
  if (!trimmedKey || trimmedKey.length < 10) {
    return { ok: false, message: 'Clé vide ou trop courte.' };
  }
  try {
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', trimmedKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Impossible de sauvegarder la clé : ${e.message}` };
  }
}

/**
 * Supprime la clé API enregistrée dans ScriptProperties.
 */
function clearApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_API_KEY');
  SpreadsheetApp.getActiveSpreadsheet().toast('Clé API supprimée.', 'Configuration');
}
