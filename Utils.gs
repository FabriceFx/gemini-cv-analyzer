/**
 * Utils.gs
 * Fonctions utilitaires diverses (parsing, requêtes HTTP simples).
 */

/**
 * Analyse et extrait le format JSON de la réponse de l'IA de manière sécurisée et robuste.
 * @param {string} text Le texte brut retourné par l'API
 * @returns {Object} L'objet JSON parsé
 */
function parseJsonSafely(text) {
  if (!text || typeof text !== 'string') {
    throw new Error("Réponse vide ou invalide de l'API.");
  }

  let cleaned = text.trim();

  // Supprimer les balises Markdown
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

  // Extraire le premier objet JSON valide
  const jsonMatch = cleaned.match(/\{[^}]*(?:\{[^}]*\}[^}]*)*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      Logger.log(`Échec du parsing JSON (match): ${e.message}`);
    }
  }

  // Essayer de parser directement
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.log(`Échec du parsing JSON (direct): ${e.message}`);
    throw new Error(`Impossible de décoder l'analyse IA. Assurez-vous que l'annonce est compréhensible. Texte reçu: "${cleaned.substring(0, 200)}..."`);
  }
}

/**
 * Valide si une chaîne est une adresse email avec un format correct.
 * @param {string} email L'adresse email à valider.
 * @returns {boolean} True si valide, false sinon.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Récupère le contenu HTML d'une page web (URL) et retourne le texte brut (scraping).
 * @param {string} url L'URL de l'annonce
 * @returns {string} Le texte brut de l'annonce
 */
function fetchJobDescription(url) {
  try {
    const match = url.match(/^https?:\/\/(?:www\.)?([^\/]+)/i);
    if (!match) throw new Error("Format d'URL invalide.");
    const domain = match[1].toLowerCase();

    // Vérifier si le domaine est autorisé
    if (!ALLOWED_DOMAINS.some(allowed => domain.includes(allowed))) {
      throw new Error(`Domaine non autorisé: ${domain}. Veuillez copier-coller le texte de l'annonce manuellement.`);
    }
  } catch (e) {
    if (e.message.includes("Domaine non autorisé")) throw e;
    throw new Error(`URL invalide: ${e.message}`);
  }

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: false, // Désactivé pour voir les erreurs SSL
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    validateHttpsCertificates: true // Vérifier les certificats SSL
  });

  const code = response.getResponseCode();
  if (code === 403 || code === 401) {
    throw new Error(`Accès refusé par le site (HTTP ${code}). Ce site protège son contenu contre la lecture automatique. Veuillez copier-coller le texte de l'annonce directement dans la cellule correspondante.`);
  }
  if (code !== 200) {
    throw new Error(`Erreur de connexion HTTP ${code}. L'annonce est peut-être temporairement inaccessible.`);
  }

  const html = response.getContentText();

  // Nettoyage basique du HTML
  const text = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Sécurité : si le texte résultant est trop court, la page bloque probablement les robots
  if (text.length < 200) {
    throw new Error(`La page de l'annonce semble vide ou protégée contre le scraping (${text.length} caractères récupérés). Veuillez copier-coller directement le texte de l'annonce.`);
  }

  // Heuristique pour détecter les pages SPA / JS-only qui chargent une coquille vide
  const textLower = text.toLowerCase();
  const keywords = ["profil", "poste", "mission", "compétence", "expérience", "experience", "recherche", "candidat"];
  let keywordCount = 0;
  for (const kw of keywords) {
    if (textLower.includes(kw)) keywordCount++;
  }
  
  if (keywordCount < 2) {
    Logger.log("Alerte Heuristique: " + text.substring(0, 500));
    throw new Error(`L'annonce récupérée semble incomplète ou générée en JavaScript (ex: LinkedIn, ATS moderne). L'IA ne pourra pas l'analyser correctement. Veuillez copier-coller le texte de l'annonce manuellement.`);
  }

  return text;
}
