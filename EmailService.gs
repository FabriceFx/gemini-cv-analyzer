/**
 * EmailService.gs
 * Lit la feuille des résultats et génère des brouillons d'emails (via l'IA) pour les candidats évalués.
 */

function draftEmailsForCandidates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName(RESULTS_SHEET_NAME);

  if (!resultsSheet) {
    SpreadsheetApp.getUi().alert("Erreur : la feuille des résultats est introuvable.");
    return;
  }

  const lastRow = resultsSheet.getLastRow();
  if (lastRow < 4) {
    SpreadsheetApp.getUi().alert("Aucun candidat trouvé dans le tableau.");
    return;
  }

  const data = resultsSheet.getRange(4, 1, lastRow - 3, 13).getValues();
  
  let contactCandidates = 0;
  let rejectCandidates = 0;
  for (let i = 0; i < data.length; i++) {
    const email = data[i][COL_INDEX.EMAIL - 1];
    const recommendation = data[i][COL_INDEX.RECOMMENDATION - 1];
    if (email && email.includes("@") && !email.toLowerCase().includes("non renseigné")) {
      if (recommendation === "À contacter" && contactCandidates < MAX_CONTACT_CANDIDATES) {
        contactCandidates++;
      } else if (recommendation === "À refuser") {
        rejectCandidates++;
      }
    }
  }

  const totalToEmail = contactCandidates + rejectCandidates;
  if (totalToEmail === 0) {
    SpreadsheetApp.getUi().alert("Aucun candidat éligible trouvé (avec email valide et recommandation 'À contacter' ou 'À refuser').");
    return;
  }

  let draftCount = 0;

  const ui = SpreadsheetApp.getUi();
  const details = `${contactCandidates} prise(s) de contact pour entretien (Top ${MAX_CONTACT_CANDIDATES} max) et ${rejectCandidates} message(s) de refus`;
  const response = ui.alert("Génération d'emails via l'IA",
    `Vous allez générer ${totalToEmail} brouillon(s) d'email personnalisé(s) (${details}).\n\nVoulez-vous lancer le traitement ?`,
    ui.ButtonSet.YES_NO);

  if (response !== ui.Button.YES) return;

  ss.toast("Génération des brouillons en cours...", "📧 Emails", 10);

  const config = getConfig();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const model = (config.model || config['Modèle Gemini'] || 'gemini-3.7-flash').toString().trim();

  if (!apiKey) {
    ui.alert("Veuillez configurer votre clé API Gemini pour générer les textes d'emails.");
    return;
  }

  let processedContactCount = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const candidateName = row[COL_INDEX.CANDIDATE - 1];
    const email = row[COL_INDEX.EMAIL - 1];
    const strengths = row[COL_INDEX.STRENGTHS - 1];
    const weaknesses = row[COL_INDEX.WEAKNESSES - 1];
    const recommendation = row[COL_INDEX.RECOMMENDATION - 1];

    if (!email || !isValidEmail(email)) {
      Logger.log(`Email invalide pour ${candidateName}: ${email}`);
      continue;
    }

    if (recommendation !== "À contacter" && recommendation !== "À refuser") {
      continue;
    }

    // Limiter la prise de contact aux MAX_CONTACT_CANDIDATES meilleurs profils
    if (recommendation === "À contacter") {
      if (processedContactCount >= MAX_CONTACT_CANDIDATES) {
        continue;
      }
      processedContactCount++;
    }

    const candidate = {
      name: candidateName,
      email: email,
      recommendation: recommendation,
      strengths: strengths,
      weaknesses: weaknesses
    };

    const draftResult = _createCandidateDraft(candidate, apiKey, model);
    if (draftResult.ok) {
      draftCount++;
      Utilities.sleep(1500); // Pause pour respecter les quotas Gemini
    } else {
      Logger.log(`Échec génération email pour ${candidateName} : ${draftResult.message}`);
    }
  }

  ui.alert(`Génération terminée : ${draftCount} brouillon(s) créé(s) dans votre boîte Gmail.`);
}

/**
 * Construit le prompt de génération d'email personnalisé selon la décision du recruteur.
 * @param {string} candidateName
 * @param {string} recommendation
 * @param {string} strengths
 * @param {string} weaknesses
 * @returns {string}
 */
function _buildCandidateEmailPrompt(candidateName, recommendation, strengths, weaknesses) {
  const firstName = (!candidateName || candidateName === "Inconnu") ? "" : (candidateName.split(' ')[0] || candidateName);
  const greeting = firstName ? `Bonjour ${firstName},` : "Bonjour,";

  let decisionContext = "Nous ne retenons pas sa candidature pour ce poste.";
  if (recommendation === "À contacter") {
    decisionContext = "Nous souhaitons le contacter pour un premier échange / entretien téléphonique.";
  } else if (recommendation === "À garder en vivier") {
    decisionContext = "Son profil est intéressant mais nous ne donnons pas suite immédiatement pour cette offre précise ; nous souhaitons conserver sa candidature dans notre vivier de talents pour de futures opportunités.";
  }

  return `Agis comme un recruteur bienveillant et professionnel.
Rédige un email très court et poli à l'intention du candidat.
Contexte : Le candidat a postulé à une de nos offres.
Décision : ${decisionContext}
Ses points forts (à mentionner brièvement s'ils sont pertinents) : ${strengths || "Non spécifiés"}
Raisons du refus ou points à creuser : ${weaknesses || "Non spécifiés"}
Rédige uniquement le corps de l'email (pas d'objet, pas de placeholders pour ma signature). Commence directement par '${greeting}'`;
}

/**
 * Crée un brouillon Gmail pour un candidat donné.
 * @param {{name: string, email: string, recommendation: string, strengths: string, weaknesses: string}} candidate
 * @param {string} apiKey
 * @param {string} model
 * @returns {{ok: boolean, message: string}}
 */
function _createCandidateDraft(candidate, apiKey, model) {
  if (!candidate.email || !isValidEmail(candidate.email)) {
    return { ok: false, message: "Adresse email invalide ou manquante." };
  }

  if (candidate.recommendation === "Erreur") {
    return { ok: false, message: "Impossible de créer un email pour un fichier en statut Erreur." };
  }

  const prompt = _buildCandidateEmailPrompt(candidate.name, candidate.recommendation, candidate.strengths, candidate.weaknesses);

  try {
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 }
    };

    const responseText = callGeminiAPI(model, payload, apiKey);
    const json = JSON.parse(responseText);
    if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
      const emailBody = json.candidates[0].content.parts[0].text;
      
      let subject = "Suite à votre candidature";
      if (candidate.recommendation === "À contacter") {
        subject = "Suite à votre candidature - Échange téléphonique";
      } else if (candidate.recommendation === "À garder en vivier") {
        subject = "Suite à votre candidature - Conservation de votre profil";
      }

      GmailApp.createDraft(candidate.email, subject, emailBody);
      return { ok: true, message: `Brouillon créé pour ${candidate.name}.` };
    }
    return { ok: false, message: "Réponse vide de l'IA lors de la rédaction de l'email." };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
