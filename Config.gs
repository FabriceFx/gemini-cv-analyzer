/**
 * Config.gs
 * Fonctions de lecture et sauvegarde de la configuration utilisateur via PropertiesService.getDocumentProperties().
 */

/**
 * Lit toutes les valeurs de configuration stockées dans DocumentProperties.
 * Assure une migration transparente si une ancienne feuille "Configuration" existe.
 * @returns {Object} Un objet dictionnaire de la configuration
 */
function getConfig() {
  const docProps = PropertiesService.getDocumentProperties();
  let props = docProps.getProperties();

  // Migration automatique si DocumentProperties est vide et qu'une ancienne feuille existe
  if (Object.keys(props).length === 0) {
    _migrateLegacyConfigSheet(docProps);
    props = docProps.getProperties();
  }

  const folderUrl = props[PROP_KEYS.FOLDER_URL] || '';
  const jobDescription = props[PROP_KEYS.JOB_DESCRIPTION] || '';
  const model = props[PROP_KEYS.MODEL] || 'gemini-3.7-flash';
  const accountType = props[PROP_KEYS.ACCOUNT_TYPE] || 'Gratuit (Free tier)';
  const criteria = props[PROP_KEYS.CRITERIA] || '';
  const systemPrompt = props[PROP_KEYS.SYSTEM_PROMPT] || DEFAULT_PROMPT;
  const retentionDays = Number(props[PROP_KEYS.RETENTION_DAYS]) || 730;
  const allowedDomains = props[PROP_KEYS.ALLOWED_DOMAINS] || DEFAULT_ALLOWED_DOMAINS.join(", ");

  return {
    "URL du dossier Drive contenant les CVs": folderUrl,
    "URL ou texte de l'annonce": jobDescription,
    "Modèle Gemini": model,
    "Type de compte Gemini": accountType,
    "Critères spécifiques du recruteur": criteria,
    "Prompt système": systemPrompt,
    "Délai de rétention RGPD (jours)": retentionDays,
    "Domaines autorisés": allowedDomains,
    // Propriétés courtes d'accès direct
    folderUrl: folderUrl,
    jobDescription: jobDescription,
    model: model,
    accountType: accountType,
    criteria: criteria,
    systemPrompt: systemPrompt,
    retentionDays: retentionDays,
    allowedDomains: allowedDomains
  };
}

/**
 * Enregistre les modifications de configuration dans DocumentProperties.
 * @param {Object} configData
 * @returns {{ok: boolean, message: string}}
 */
function saveConfig(configData) {
  if (!configData || typeof configData !== 'object') {
    return { ok: false, message: "Données de configuration invalides." };
  }

  try {
    const docProps = PropertiesService.getDocumentProperties();
    const updates = {};

    if (configData.folderUrl !== undefined) updates[PROP_KEYS.FOLDER_URL] = String(configData.folderUrl).trim();
    if (configData.jobDescription !== undefined) updates[PROP_KEYS.JOB_DESCRIPTION] = String(configData.jobDescription).trim();
    if (configData.model !== undefined) updates[PROP_KEYS.MODEL] = String(configData.model).trim();
    if (configData.accountType !== undefined) updates[PROP_KEYS.ACCOUNT_TYPE] = String(configData.accountType).trim();
    if (configData.criteria !== undefined) updates[PROP_KEYS.CRITERIA] = String(configData.criteria).trim();
    if (configData.systemPrompt !== undefined) updates[PROP_KEYS.SYSTEM_PROMPT] = String(configData.systemPrompt).trim();
    if (configData.retentionDays !== undefined) updates[PROP_KEYS.RETENTION_DAYS] = String(Number(configData.retentionDays) || 730);
    if (configData.allowedDomains !== undefined) updates[PROP_KEYS.ALLOWED_DOMAINS] = String(configData.allowedDomains).trim();

    docProps.setProperties(updates);
    return { ok: true, message: "Configuration enregistrée avec succès." };
  } catch (e) {
    return { ok: false, message: "Erreur sauvegarde configuration : " + e.message };
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
      "URL du dossier Drive contenant les CVs": PROP_KEYS.FOLDER_URL,
      "URL ou texte de l'annonce": PROP_KEYS.JOB_DESCRIPTION,
      "Modèle Gemini": PROP_KEYS.MODEL,
      "Type de compte Gemini": PROP_KEYS.ACCOUNT_TYPE,
      "Critères spécifiques du recruteur": PROP_KEYS.CRITERIA,
      "Prompt système": PROP_KEYS.SYSTEM_PROMPT,
      "Délai de rétention RGPD (jours)": PROP_KEYS.RETENTION_DAYS,
      "Domaines autorisés": PROP_KEYS.ALLOWED_DOMAINS
    };

    const toSet = {};
    data.forEach(row => {
      const label = (row[0] || '').toString().trim();
      const val = (row[1] || '').toString().trim();
      if (mapping[label] && val) {
        toSet[mapping[label]] = val;
      }
    });

    if (Object.keys(toSet).length > 0) {
      docProps.setProperties(toSet);
      Logger.log("Migration de l'ancienne feuille Configuration effectuée avec succès.");
    }
  } catch (e) {
    Logger.log("Erreur lors de la migration de l'ancienne feuille : " + e.message);
  }
}

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
