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
  let cleaned = text.trim();

  // Extraction sécurisée par RegEx (capture l'objet JSON central en ignorant le texte avant/après)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Continue vers le bloc try/catch global si l'extraction par regex échoue
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Suppression explicite des balises de code Markdown en dernier recours
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
      try {
        return JSON.parse(cleaned);
      } catch (nestedErr) { }
    }
    throw new Error(`Impossible de décoder l'analyse IA. Assurez-vous que l'annonce est compréhensible. Détail : ${e.message}`);
  }
}

/**
 * Récupère le contenu HTML d'une page web (URL) et retourne le texte brut (scraping).
 * @param {string} url L'URL de l'annonce
 * @returns {string} Le texte brut de l'annonce
 */
function fetchJobDescription(url) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
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
