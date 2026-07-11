/**
 * DriveService.gs
 * Fonctions liées à Google Drive (récupération d'ID, lecture de fichiers).
 */

/**
 * Extrait l'identifiant (25+ caractères) du dossier Google Drive à partir d'un lien complet.
 * @param {string} url 
 * @returns {string|null}
 */
function getFolderIdFromUrl(url) {
  if (!url) return null;
  const matches = url.match(/folders\/([a-zA-Z0-9-_]{25,})/);
  if (matches && matches[1]) {
    return matches[1];
  }
  if (url.match(/^[a-zA-Z0-9-_]{25,}$/)) {
    return url;
  }
  return null;
}
