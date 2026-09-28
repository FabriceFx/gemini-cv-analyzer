/**
 * GeminiClient.gs
 * Client pour l'API Gemini : appels, schémas JSON et lecture des réponses.
 *
 * Le cache de contexte explicite des versions antérieures a été retiré en
 * v1.0 : il ne se déclenchait qu'au-delà de 130 000 caractères de prompt,
 * seuil qu'une annonce et sa grille n'atteignent jamais. Le préfixe commun
 * (prompt, annonce, grille) reste en tête de chaque requête, ce qui laisse
 * jouer la mise en cache implicite des modèles qui la proposent.
 */

/**
 * Nettoie et structure le texte brut récupéré d'une annonce web à l'aide de l'IA Gemini.
 */
function extractJobDescriptionWithGemini(rawText, apiKey, model) {
  const truncatedText = rawText.substring(0, 45000);

  const systemInstruction = "Vous êtes un assistant spécialisé dans le recrutement. Votre but est d'extraire la fiche descriptive d'un poste, de manière claire et organisée, en français, à partir de texte brut.";
  const userPrompt = `Voici le texte extrait de la page web de l'annonce. Extrayez uniquement, en 5 000 caractères au plus :\n- le titre du poste et l'entreprise ;\n- les missions principales ;\n- les compétences exigées et le profil recherché (expérience, technologies, diplôme), en distinguant ce qui est exigé de ce qui est souhaité ;\n- les autres modalités (télétravail, salaire, localisation).\n\nNe conservez rien d'autre (menus du site, liens externes, etc.).\n\nTexte brut :\n${truncatedText}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.1 },
  };

  return _extractGeminiText(callGeminiAPI(model, payload, apiKey));
}

/**
 * Convertit un fichier DOCX en Blob PDF via le service avancé Drive.
 * @param {GoogleAppsScript.Drive.File} file
 * @returns {GoogleAppsScript.Base.Blob}
 */
function _convertDocxToPdfBlob(file) {
  if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.copy) {
    const copy = Drive.Files.copy(
      { title: `tmp_${file.getName()}` },
      file.getId(),
      { convert: true },
    );
    try {
      const tempDoc = DriveApp.getFileById(copy.id);
      return tempDoc.getAs(MimeType.PDF);
    } finally {
      try {
        Drive.Files.remove(copy.id);
      } catch (delErr) {
        try { DriveApp.getFileById(copy.id).setTrashed(true); } catch (e) { }
      }
    }
  }
  throw new Error(`Le service Drive avancé n'est pas disponible pour convertir "${file.getName()}". Enregistrez-le en PDF.`);
}

/**
 * Lit et prépare un fichier Drive pour l'envoi à Gemini (supporte les PDF jusqu'à 20 Mo).
 * @returns {{file, mimeType, base64Data}}
 */
function _prepareDocumentEntry(file) {
  const fileSizeBytes = file.getSize();
  if (fileSizeBytes > MAX_FILE_SIZE) {
    throw new Error(`Le fichier "${file.getName()}" est trop volumineux (${Math.round(fileSizeBytes / 1024 / 1024)} Mo). Maximum : 20 Mo.`);
  }
  if (fileSizeBytes === 0 && file.getMimeType() !== MimeType.GOOGLE_DOCS) {
    // Précaution : un fichier natif Google a longtemps déclaré 0 octet (hors
    // quota). La documentation actuelle ne le dit plus, mais rien ne garantit
    // qu'un Google Doc non vide ne rende pas 0 ; il est donc exporté quand même.
    throw new Error(`Le fichier "${file.getName()}" est vide (0 octet).`);
  }

  let blob;
  let mimeType;
  try {
    mimeType = file.getMimeType();

    if (mimeType === MimeType.GOOGLE_DOCS) {
      blob = file.getBlob().getAs(MimeType.PDF);
      mimeType = MimeType.PDF;
    } else if (mimeType === MIME_DOCX) {
      blob = _convertDocxToPdfBlob(file);
      mimeType = MimeType.PDF;
    } else {
      blob = file.getBlob();
    }
  } catch (e) {
    throw new Error(`Impossible de lire ou convertir "${file.getName()}". Détail : ${e.message}`);
  }

  return { file, mimeType, base64Data: Utilities.base64Encode(blob.getBytes()) };
}

/**
 * Contexte commun à tous les CV d'une exécution : prompt final, grille,
 * schéma. Construit une fois, pas une fois par CV.
 * @returns {{apiKey: string, model: string, promptFinal: string, criteres: Object[], schema: Object, dateDuJour: string}}
 */
const contexteEvaluation_ = ({ apiKey, model, prompt, annonce, criteres, consignes }) => ({
  apiKey,
  model,
  criteres,
  // split/join plutôt que replace : une annonce qui contient « $& » ou « $' »
  // serait sinon réécrite par les motifs spéciaux de String.replace.
  promptFinal: prompt
    .split('{{JOB_DESCRIPTION}}').join(annonce)
    .split('{{CRITERIA}}').join(rendreGrillePourPrompt_(criteres, consignes)),
  schema: schemaEvaluation_(criteres),
  dateDuJour: dateLisible_(new Date()),
});

/** Requête d'évaluation d'un CV : le préfixe commun d'abord, le document ensuite. */
function _buildDocumentPayload(entry, contexte) {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: contexte.promptFinal },
        { text: `Date du jour : ${contexte.dateDuJour}. Voici le CV à évaluer.` },
        { inlineData: { mimeType: entry.mimeType, data: entry.base64Data } },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: contexte.schema,
      temperature: 0.1,
    },
  };
}

/**
 * Texte de la réponse, ou une erreur qui dit pourquoi il n'y en a pas.
 *
 * Avant la v1.0, une réponse bloquée ou tronquée donnait « résultat non
 * valide » sans motif ; le motif rendu par Gemini (SAFETY, MAX_TOKENS…) dit
 * pourtant quoi faire.
 */
function _extractGeminiText(responseText) {
  const json = JSON.parse(responseText);
  const candidat = json.candidates && json.candidates[0];
  const parts = candidat && candidat.content && Array.isArray(candidat.content.parts) ? candidat.content.parts : [];
  const texte = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  if (texte) {
    if (candidat.finishReason === 'MAX_TOKENS') {
      throw new Error('Réponse de Gemini tronquée (limite de longueur atteinte) : allégez la grille ou vérifiez le CV.');
    }
    return texte;
  }
  if (json.promptFeedback && json.promptFeedback.blockReason) {
    throw new Error(`Requête bloquée par Gemini (motif : ${json.promptFeedback.blockReason}).`);
  }
  if (candidat && candidat.finishReason) {
    throw new Error(`Gemini n'a rendu aucun texte (motif : ${candidat.finishReason}).`);
  }
  throw new Error("L'API Gemini n'a pas renvoyé de résultat valide.");
}

/**
 * Lit une évaluation rendue par Gemini et la rattache aux critères de la grille.
 *
 * Un critère sans statut valide rend la réponse inutilisable : l'erreur est
 * levée, la ligne passe « Erreur » et sera retentée. Compter ce critère comme
 * « Non démontré » aurait fait d'une réponse incomplète un mauvais candidat.
 */
const lireAnalyse_ = (texteReponse, criteres) => {
  const brute = parseJsonSafely(texteReponse);
  const bloc = brute && typeof brute.criteres === 'object' && brute.criteres !== null ? brute.criteres : {};
  const statuts = Object.values(STATUTS_CRITERE);
  const evaluations = {};
  const manquants = [];
  criteres.forEach((c) => {
    const ev = bloc[c.code];
    if (!ev || !statuts.includes(ev.statut)) {
      manquants.push(c.code);
      return;
    }
    evaluations[c.cle] = {
      statut: ev.statut,
      preuve: ev.statut === STATUTS_CRITERE.NON_DEMONTRE ? '' : tronquer_(ev.preuve, 300),
      empreinte: c.empreinte,
    };
  });
  if (manquants.length > 0) {
    throw new Error(`Réponse incomplète de Gemini : ${manquants.join(', ')} sans statut valide.`);
  }
  const texte = (v) => normaliserEspaces_(v);
  return {
    candidateName: texte(brute.candidateName),
    email: texte(brute.email),
    phone: texte(brute.phone),
    experience: texte(brute.experience),
    education: texte(brute.education),
    strengths: texte(brute.strengths),
    weaknesses: texte(brute.weaknesses),
    evaluations,
  };
};

/** Analyse un seul document. */
function analyzeSingleDocument(file, contexte) {
  const entry = _prepareDocumentEntry(file);
  const responseText = callGeminiAPI(contexte.model, _buildDocumentPayload(entry, contexte), contexte.apiKey);
  return lireAnalyse_(_extractGeminiText(responseText), contexte.criteres);
}

/**
 * Analyse un lot de documents en parallèle via fetchAll.
 * Les échecs 429 individuels sont retentés en solo avec backoff exponentiel.
 * @returns {Array<{file, analysis?, error?}>}
 */
function analyzeDocumentsBatch(files, contexte) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${contexte.model}:generateContent`;

  const entries = [];
  const prepErrors = [];

  for (const file of files) {
    try {
      entries.push(_prepareDocumentEntry(file));
    } catch (e) {
      prepErrors.push({ file, error: e.message });
    }
  }

  if (entries.length === 0) {
    return prepErrors;
  }

  // Sous-lots de 5 requêtes parallèles au plus, pour respecter les quotas.
  const SUB_BATCH_SIZE = Math.min(5, entries.length);
  const subBatches = [];
  for (let i = 0; i < entries.length; i += SUB_BATCH_SIZE) {
    subBatches.push(entries.slice(i, i + SUB_BATCH_SIZE));
  }

  const results = [...prepErrors];
  subBatches.forEach((subBatch, batchIdx) => {
    const requests = subBatch.map((entry) => ({
      url,
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': contexte.apiKey },
      payload: JSON.stringify(_buildDocumentPayload(entry, contexte)),
      muteHttpExceptions: true,
    }));

    const responses = UrlFetchApp.fetchAll(requests);

    responses.forEach((response, i) => {
      const entry = subBatch[i];
      const code = response.getResponseCode();

      if (code === 200) {
        try {
          results.push({ file: entry.file, analysis: lireAnalyse_(_extractGeminiText(response.getContentText()), contexte.criteres) });
        } catch (e) {
          results.push({ file: entry.file, error: e.message });
        }
      } else if (code === 429) {
        // Throttle isolé sur ce document précis : retry solo avec backoff
        try {
          const retryText = callGeminiAPI(contexte.model, _buildDocumentPayload(entry, contexte), contexte.apiKey);
          results.push({ file: entry.file, analysis: lireAnalyse_(_extractGeminiText(retryText), contexte.criteres) });
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

    if (batchIdx < subBatches.length - 1) {
      Utilities.sleep(1000);
    }
  });

  return results;
}

/**
 * Génère une phrase de synthèse globale et un conseil pour la session de recrutement.
 */
function generateSessionSynthesis(candidatesSummary, jobDescription, apiKey, model) {
  const systemInstruction = 'Vous êtes un recruteur senior. Votre rôle est de donner un conseil final en une seule phrase après l\'analyse de plusieurs CV.';
  const prompt = `Voici la description du poste :\n${jobDescription}\n\nVoici le résumé des candidats évalués (score sur 100 calculé à partir de la grille de l'équipe RH) :\n${candidatesSummary}\n\nRédigez une unique phrase de synthèse, de conseil et d'orientation actionnable. Soyez direct, professionnel et concis. Ne dépassez pas 35 mots.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.2 },
  };

  return _extractGeminiText(callGeminiAPI(model, payload, apiKey)).trim();
}

/**
 * Fonction d'appel à l'API Gemini avec gestion des tentatives et du délai d'attente (limites de requêtes HTTP 429).
 * Utilise l'en-tête sécurisé x-goog-api-key.
 */
function callGeminiAPI(model, payload, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const maskedApiKey = apiKey ? `${apiKey.substring(0, 6)}...` : 'non définie';
  Logger.log(`Appel API Gemini avec modèle: ${model}, clé: ${maskedApiKey}`);

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const maxRetries = 5;
  let delay = 2500;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code === 200) {
      return text;
    }

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
      throw new Error('Clé API Gemini invalide ou expirée (HTTP 401).');
    }
    if (code === 403) {
      throw new Error('Accès refusé par l\'API Gemini (HTTP 403). Vérifiez votre clé.');
    }

    lastError = errorMsg;
    break;
  }

  throw new Error(lastError || "Échec de l'appel à l'API après plusieurs tentatives.");
}
