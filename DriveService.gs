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
  // Support pour les URLs de fichiers (pas seulement dossiers)
  const folderMatch = url.match(/folders\/([a-zA-Z0-9-_]{25,})/);
  const fileMatch = url.match(/file\/d\/([a-zA-Z0-9-_]{25,})/);
  if (folderMatch && folderMatch[1]) return folderMatch[1];
  if (fileMatch && fileMatch[1]) return fileMatch[1];

  if (url.match(/^[a-zA-Z0-9-_]{25,}$/)) {
    return url;
  }
  return null;
}
