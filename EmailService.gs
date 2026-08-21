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

  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  const config = getConfig(configSheet);
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const model = (config['Modèle Gemini'] || 'gemini-3.7-flash').toString().trim();

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

    const isAccepted = recommendation === "À contacter";
    const prompt = `Agis comme un recruteur bienveillant et professionnel.
Rédige un email très court et poli à l'intention de "${candidateName}".
Contexte : Le candidat a postulé à une de nos offres.
Décision : ${isAccepted ? "Nous souhaitons le contacter pour un entretien." : "Nous ne retenons pas sa candidature pour ce poste."}
Ses points forts (à mentionner brièvement s'ils sont pertinents) : ${strengths}
Raisons du refus (si refus) ou points à creuser (si accepté) : ${weaknesses}
Rédige uniquement le corps de l'email (pas d'objet, pas de placeholders pour ma signature). Commence directement par 'Bonjour ${candidateName.split(' ')[0] || candidateName},'`;

    let emailBody = "";
    try {
      const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 }
      };

      const responseText = callGeminiAPI(model, payload, apiKey);
      const json = JSON.parse(responseText);
      if (json.candidates && json.candidates[0]) {
        emailBody = json.candidates[0].content.parts[0].text;
      }
    } catch (e) {
      Logger.log("Erreur lors de la génération de l'email pour " + candidateName + ": " + e.message);
      continue;
    }

    if (emailBody) {
      const subject = isAccepted ? `Suite à votre candidature - Échange téléphonique` : `Suite à votre candidature`;
      GmailApp.createDraft(email, subject, emailBody);
      draftCount++;
      Utilities.sleep(1500); // Pause pour respecter les quotas Gemini
    }
  }

  ui.alert(`Génération terminée : ${draftCount} brouillon(s) créé(s) dans votre boîte Gmail.`);
}
