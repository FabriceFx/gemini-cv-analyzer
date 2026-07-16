/**
 * GeminiClient.gs
 * Client pour l'API Gemini : gestion du cache, appels, et extraction.
 */

/**
 * Tente de créer un Context Cache pour la session courante si le texte est très long.
 * (Gemini nécessite généralement >32k tokens pour activer le cache).
 * @returns {string|null} Le nom du cache créé, ou null si non applicable.
 */
function createGeminiCache(apiKey, model, systemPrompt, jobDescription, criteria) {
  // Sécurité: Ne tenter le cache que si le texte est très long pour éviter l'erreur "minimum token count not met" (~32k tokens)
  const fullText = systemPrompt + jobDescription + criteria;
  if (fullText.length < 130000) {
    return null; // Trop court pour le caching
  }

  const payload = {
    model: `models/${model}`,
    contents: [{
      role: "user",
      parts: [
        { text: "Contexte de l'offre d'emploi :\n" + jobDescription },
        { text: "Critères :\n" + criteria }
      ]
    }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    ttl: "1800s" // 30 minutes
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() === 200) {
    const json = JSON.parse(response.getContentText());
    return json.name; // Retourne le nom du cache (ex: "cachedContents/xxx")
  }
  
  Logger.log("Info: Le cache n'a pas pu être créé (peut-être texte trop court). Code: " + response.getResponseCode());
  return null;
}

/**
 * Nettoie et structure le texte brut récupéré d'une annonce web à l'aide de l'IA Gemini.
 */
function extractJobDescriptionWithGemini(rawText, apiKey, model) {
  const truncatedText = rawText.substring(0, 45000);

  const systemInstruction = "Vous êtes un assistant spécialisé dans le recrutement de talents. Votre but est d'extraire la fiche descriptive d'un poste de manière claire et organisée en français à partir de texte brut.";
  const userPrompt = `Voici le texte extrait de la page web de l'annonce. Extrayez uniquement :\n- Le titre du poste et l'entreprise\n- Les missions principales\n- Les compétences exigées et profil recherché (XP, techno, diplôme)\n- Autres modalités (télétravail, salaire, localisation)\n\nNe conservez rien d'autre (ignorez les menus du site, les liens externes, etc.).\n\nTexte brut :\n${truncatedText}`;

  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: userPrompt }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.1
    }
  };

  const responseText = callGeminiAPI(model, payload, apiKey);
  const json = JSON.parse(responseText);

  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text;
  }
  throw new Error("L'API a retourné un format vide lors du nettoyage de l'offre d'emploi.");
}

/**
 * Lit et prépare un fichier Drive pour l'envoi à Gemini (I/O, non parallélisable, doit rester séquentiel).
 * @returns {{file, mimeType, base64Data}}
 */
function _prepareDocumentEntry(file) {
  const fileSizeBytes = file.getSize();
  if (fileSizeBytes > MAX_FILE_SIZE) {
    throw new Error(`Le fichier "${file.getName()}" est trop volumineux (${Math.round(fileSizeBytes / 1024 / 1024)} MB). Maximum : 20 MB.`);
  }
  if (fileSizeBytes === 0) {
    throw new Error(`Le fichier "${file.getName()}" est vide (0 octet).`);
  }

  // Ajouter une estimation de tokens (1 token ≈ 4 caractères pour du texte)
  const estimatedTokens = fileSizeBytes / 4;
  if (estimatedTokens > MAX_TOTAL_TOKENS_PER_REQUEST) {
    throw new Error(`Le fichier "${file.getName()}" est trop grand en tokens (${Math.round(estimatedTokens)}). Max: ${MAX_TOTAL_TOKENS_PER_REQUEST}.`);
  }

  let blob, mimeType;
  try {
    blob = file.getBlob();
    mimeType = file.getMimeType();
    if (mimeType === MimeType.GOOGLE_DOCS || (mimeType !== MimeType.PDF && mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      blob = blob.getAs(MimeType.PDF);
      mimeType = MimeType.PDF;
    }
  } catch (e) {
    throw new Error(`Impossible de lire le fichier "${file.getName()}". Il est peut-être protégé. Détail : ${e.message}`);
  }

  return { file, mimeType, base64Data: Utilities.base64Encode(blob.getBytes()) };
}

const DOCUMENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidateName: { type: "STRING", description: "Nom et Prénom du candidat. Écrire 'Inconnu' si introuvable." },
    email: { type: "STRING", description: "Adresse email du candidat. Écrire 'Non renseigné' si introuvable." },
    phone: { type: "STRING", description: "Numéro de téléphone du candidat. Écrire 'Non renseigné' si introuvable." },
    experience: { type: "STRING", description: "Résumé des expériences pertinentes en une phrase synthétique." },
    education: { type: "STRING", description: "Résumé des diplômes en une phrase." },
    skills: { type: "STRING", description: "Les 3 compétences clés pour le poste avec 'Oui', 'Non', ou 'Partiel'." },
    strengths: { type: "STRING", description: "Points forts pour le poste en texte fluide." },
    weaknesses: { type: "STRING", description: "Points faibles ou questions à creuser en texte fluide." },
    recommendation: { type: "STRING", description: "Strictement l'une de ces 3 valeurs : 'À contacter', 'À garder en vivier', 'À refuser'." },
    score: { type: "INTEGER", description: "Note sur 5 basée sur l'adéquation au poste." }
  },
  required: ["candidateName", "email", "phone", "experience", "education", "skills", "strengths", "weaknesses", "recommendation", "score"]
};

/** Construit le payload Gemini pour un document préparé, en tenant compte du cache éventuel. */
function _buildDocumentPayload(entry, jobDescription, criteria, systemPrompt, cacheName) {
  const payload = {
    contents: [{
      role: "user",
      parts: [{ inlineData: { mimeType: entry.mimeType, data: entry.base64Data } }]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: DOCUMENT_RESPONSE_SCHEMA,
      temperature: 0.1
    }
  };

  if (cacheName) {
    payload.cachedContent = cacheName;
  } else {
    const finalPrompt = systemPrompt
      .replace("{{JOB_DESCRIPTION}}", jobDescription)
      .replace("{{CRITERIA}}", criteria || "Aucun critère particulier spécifié.");
    payload.contents[0].parts.unshift({ text: finalPrompt });
  }
  return payload;
}

function _extractGeminiText(responseText) {
  const json = JSON.parse(responseText);
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text;
  }
  throw new Error("L'API Gemini n'a pas renvoyé de résultat valide.");
}

/** Analyse un seul document (conservé pour analyzeSingleCV, comportement inchangé). */
function analyzeSingleDocument(file, apiKey, model, jobDescription, criteria, systemPrompt, cacheName) {
  const entry = _prepareDocumentEntry(file);
  const payload = _buildDocumentPayload(entry, jobDescription, criteria, systemPrompt, cacheName);
  const responseText = callGeminiAPI(model, payload, apiKey);
  return parseJsonSafely(_extractGeminiText(responseText));
}

/**
 * Analyse un lot de documents en parallèle via fetchAll.
 * Les échecs 429 individuels sont retentés en solo (callGeminiAPI gère déjà le backoff exponentiel).
 * @returns {Array<{file, analysis, error}>}
 */
function analyzeDocumentsBatch(files, apiKey, model, jobDescription, criteria, systemPrompt, cacheName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const entries = [];
  const prepErrors = [];
  
  // Calculer la taille totale estimée du batch
  let totalEstimatedTokens = 0;
  for (const file of files) {
    try {
      const entry = _prepareDocumentEntry(file);
      totalEstimatedTokens += entry.base64Data.length / 4; // Estimation grossière
      entries.push(entry);
    } catch (e) {
      prepErrors.push({ file, error: e.message });
    }
  }

  if (entries.length === 0) {
    return prepErrors;
  }

  // Diviser en sous-batches si trop gros
  const avgTokensPerFile = totalEstimatedTokens / entries.length;
  const SUB_BATCH_SIZE = Math.max(1, Math.floor(MAX_BATCH_TOKENS / avgTokensPerFile));
  
  const subBatches = [];
  for (let i = 0; i < entries.length; i += SUB_BATCH_SIZE) {
    subBatches.push(entries.slice(i, i + SUB_BATCH_SIZE));
  }

  // Traiter chaque sous-batch séquentiellement
  const results = [...prepErrors];
  for (const subBatch of subBatches) {
    const requests = subBatch.map(entry => ({
      url,
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(_buildDocumentPayload(entry, jobDescription, criteria, systemPrompt, cacheName)),
      muteHttpExceptions: true
    }));

    const responses = requests.length ? UrlFetchApp.fetchAll(requests) : [];

    responses.forEach((response, i) => {
      const entry = subBatch[i];
      const code = response.getResponseCode();

      if (code === 200) {
        try {
          results.push({ file: entry.file, analysis: parseJsonSafely(_extractGeminiText(response.getContentText())) });
        } catch (e) {
          results.push({ file: entry.file, error: `Réponse illisible : ${e.message}` });
        }
      } else if (code === 429) {
        // Throttle isolé sur ce document précis : retry solo avec backoff
        try {
          const retryText = callGeminiAPI(model, _buildDocumentPayload(entry, jobDescription, criteria, systemPrompt, cacheName), apiKey);
          results.push({ file: entry.file, analysis: parseJsonSafely(_extractGeminiText(retryText)) });
        } catch (retryErr) {
          results.push({ file: entry.file, error: retryErr.message });
        }
      } else {
        let errorMsg = `Erreur HTTP ${code}`;
        try {
          const errJson = JSON.parse(response.getContentText());
          if (errJson && errJson.error && errJson.error.message) errorMsg = errJson.error.message;
        } catch (e) { }
        results.push({ file: entry.file, error: errorMsg });
      }
    });

    // Pause entre les sous-batches pour éviter le rate limiting (sauf pour le dernier)
    if (subBatches.length > 1) {
      Utilities.sleep(1000);
    }
  }

  return results;
}

/** Supprime explicitement un Context Cache Gemini plutôt que d'attendre son expiration par TTL. */
function deleteGeminiCache(cacheName, apiKey) {
  if (!cacheName) return;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/${cacheName}?key=${apiKey}`;
    UrlFetchApp.fetch(url, { method: "delete", muteHttpExceptions: true });
  } catch (e) {
    Logger.log("Info : échec de la suppression explicite du cache (il expirera via son TTL de toute façon). " + e.message);
  }
}

/**
 * Génère une phrase de synthèse globale et un conseil pour la session de recrutement.
 */
function generateSessionSynthesis(candidatesSummary, jobDescription, apiKey, model) {
  const systemInstruction = "Vous êtes un Recruteur Senior conseil. Votre rôle est de donner un conseil final en une seule phrase après l'analyse de plusieurs CVs.";
  const prompt = `Voici la description du poste :\n${jobDescription}\n\nVoici le résumé des candidats évalués :\n${candidatesSummary}\n\nRédigez une unique phrase de synthèse de conseil et d'orientation actionnable. Soyez direct, professionnel et concis. Ne dépassez pas 35 mots.`;

  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.2
    }
  };

  const responseText = callGeminiAPI(model, payload, apiKey);
  const json = JSON.parse(responseText);
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    return json.candidates[0].content.parts[0].text.trim();
  }
  throw new Error("Réponse vide de l'API pour la synthèse de session.");
}

/**
 * Fonction d'appel à l'API Gemini avec gestion des tentatives et du délai d'attente (limites de requêtes HTTP 429).
 */
function callGeminiAPI(model, payload, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Masquer la clé API dans les logs
  const maskedApiKey = apiKey ? `${apiKey.substring(0, 6)}...` : "non définie";
  Logger.log(`Appel API Gemini avec modèle: ${model}, clé: ${maskedApiKey}`);

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const maxRetries = 5; // Augmenté pour la robustesse
  let delay = 2500;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code === 200) {
      return text;
    }

    // Gérer les erreurs 500/503 comme les 429
    if (code === 429 || code === 500 || code === 503) {
      Logger.log(`API Gemini (${code}) - Tentative ${attempt + 1}/${maxRetries}. Attente: ${delay}ms`);
      Utilities.sleep(delay);
      delay *= 2;
      lastError = `Erreur ${code} après ${maxRetries} tentatives.`;
      continue;
    }

    let errorMsg = `Erreur HTTP ${code}`;
    try {
      const errJson = JSON.parse(text);
      if (errJson && errJson.error && errJson.error.message) {
        errorMsg = errJson.error.message;
      }
    } catch (e) { }

    if (code === 400) {
      throw new Error(`Requête invalide (HTTP 400). Le document est peut-être trop complexe ou non supporté. Détail : ${errorMsg}`);
    }
    if (code === 401) {
      throw new Error("Clé API Gemini invalide ou expirée (HTTP 401).");
    }
    if (code === 403) {
      throw new Error("Accès refusé par l'API Gemini (HTTP 403). Vérifiez votre clé.");
    }

    lastError = errorMsg;
    // Break the loop for other errors (client errors)
    break;
  }

  throw new Error(lastError || "Échec de l'appel à l'API après plusieurs tentatives.");
}
