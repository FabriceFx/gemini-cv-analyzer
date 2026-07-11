/**
 * Config.gs
 * Fonctions de lecture et sauvegarde de la configuration utilisateur.
 */

/**
 * Lit toutes les valeurs de configuration depuis la feuille (colonne A pour les libellés)
 * et retourne un objet simple {libellé: valeur}. Résiste aux insertions de lignes.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} configSheet
 * @returns {Object} Un objet dictionnaire de la configuration
 */
function getConfig(configSheet) {
  const data = configSheet.getRange('A:B').getValues();
  const config = {};
  data.forEach(row => {
    if (row[0]) config[row[0].toString()] = row[1];
  });
  return config;
}

/**
 * Enregistre la clé API Gemini de manière sécurisée dans PropertiesService. Retourne {ok, message}.
 * @param {string} key
 * @returns {Object} Statut de l'enregistrement
 */
function saveApiKey(key) {
  const trimmedKey = (key || '').trim();
  // La validation est également effectuée côté client ; ceci est une sécurité côté serveur
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
 * Supprime la clé API enregistrée dans PropertiesService. 
 */
function clearApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_API_KEY');
  SpreadsheetApp.getActiveSpreadsheet().toast('Clé API supprimée.', 'Configuration');
}
