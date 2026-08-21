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
 * Valide si un domaine web fait partie de la liste autorisée (exact ou sous-domaine).
 * @param {string} domain Le domaine à tester (ex: "sub.linkedin.com")
 * @param {string} allowedDomainsStr Liste des domaines autorisés séparés par des virgules
 * @returns {boolean} True si autorisé, false sinon.
 */
function isDomainAllowed(domain, allowedDomainsStr) {
  if (!domain) return false;
  const cleanDomain = domain.toLowerCase().trim();
  const allowedList = (allowedDomainsStr || "").split(",")
    .map(d => d.trim().toLowerCase())
    .filter(d => d);
  
  return allowedList.some(allowed => cleanDomain === allowed || cleanDomain.endsWith("." + allowed));
}

/**
 * Fonction pure de calcul des recommandations pour la prise de contact.
 * Plafonne le statut "À contacter" aux MAX_CONTACT_CANDIDATES meilleurs profils qualifiés (note >= MIN_CONTACT_SCORE).
 * Les profils qualifiés au-delà du plafond basculent en "À garder en vivier".
 * Les profils avec note < MIN_CONTACT_SCORE ne sont jamais proposés en prise de contact active.
 * 
 * @param {Array<{recommendation: string, score: number}>} candidates
 * @param {number} [maxContact=MAX_CONTACT_CANDIDATES]
 * @param {number} [minScore=MIN_CONTACT_SCORE]
 * @returns {Array<string>} Nouvelle liste des recommandations harmonisées
 */
function computeContactRecommendations(candidates, maxContact = MAX_CONTACT_CANDIDATES, minScore = MIN_CONTACT_SCORE) {
  let contactCount = 0;
  return candidates.map(c => {
    const reco = (c.recommendation || '').toString().trim();
    const score = Number(c.score) || 0;

    const isQualifying = (reco === "À contacter" || score >= minScore) && reco !== "À refuser" && score >= 3;

    if (isQualifying && score >= minScore) {
      if (contactCount < maxContact) {
        contactCount++;
        return "À contacter";
      } else {
        return "À garder en vivier";
      }
    } else if (reco === "À contacter" && score < minScore) {
      return score <= 2 ? "À refuser" : "À garder en vivier";
    }
    return reco || "À garder en vivier";
  });
}

/**
 * Extrait le nom de domaine d'une URL de façon sécurisée (anti-contournement userinfo, query, port, fragment).
 * @param {string} url
 * @returns {string|null}
 */
function extractDomainFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/^https?:\/\/(?:www\.)?([^\/:?#@]+)(?::\d+)?(?=[\/?#]|$)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Récupère le contenu HTML d'une page web (URL) et retourne le texte brut (scraping).
 * @param {string} url L'URL de l'annonce
 * @param {string} allowedDomainsStr Liste des domaines séparés par des virgules
 * @returns {string} Le texte brut de l'annonce
 */
function fetchJobDescription(url, allowedDomainsStr) {
  const domain = extractDomainFromUrl(url);
  if (!domain) {
    throw new Error("Format d'URL invalide.");
  }

  // Vérifier si le domaine est autorisé de façon stricte (exact ou sous-domaine)
  if (!isDomainAllowed(domain, allowedDomainsStr)) {
    throw new Error(`Domaine non autorisé: ${domain}. Veuillez copier-coller le texte de l'annonce manuellement ou l'ajouter aux Domaines autorisés dans la Configuration.`);
  }

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: false,
    followRedirects: false,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    validateHttpsCertificates: true
  });

  const code = response.getResponseCode();
  if (code >= 300 && code < 400) {
    throw new Error(`L'URL redirige vers une autre page (HTTP ${code}). Veuillez copier-coller l'URL finale de l'offre d'emploi ou son texte directement dans la cellule.`);
  }
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
