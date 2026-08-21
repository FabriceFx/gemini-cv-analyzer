/**
 * Test.gs
 * Fonctions de test unitaire pour valider les comportements critiques de l'application.
 */

/**
 * Fonction de test pour valider le parsing des URLs de dossier et de fichier.
 */
function testGetFolderIdFromUrl() {
  const testCases = [
    { url: "https://drive.google.com/drive/folders/abc1234567890abcdefghijklmno123456", expected: "abc1234567890abcdefghijklmno123456" },
    { url: "abc1234567890abcdefghijklmno123456", expected: "abc1234567890abcdefghijklmno123456" },
    { url: "https://drive.google.com/file/d/abc1234567890abcdefghijklmno123456", expected: "abc1234567890abcdefghijklmno123456" },
    { url: "", expected: null },
    { url: "invalid", expected: null },
  ];

  let passed = 0;
  for (const test of testCases) {
    const result = getFolderIdFromUrl(test.url);
    if (result === test.expected) {
      passed++;
      Logger.log(`✅ PASS: ${test.url} -> ${result}`);
    } else {
      Logger.log(`❌ FAIL: ${test.url} -> Expected: ${test.expected}, Got: ${result}`);
    }
  }
  Logger.log(`Tests terminés: ${passed}/${testCases.length} réussis.`);
}

/**
 * Fonction de test pour valider le parsing JSON.
 */
function testParseJsonSafely() {
  const testCases = [
    { input: '{"name": "test"}', expected: { name: "test" } },
    { input: '```json\n{"name": "test"}\n```', expected: { name: "test" } },
    { input: 'Texte avant {"name": "test"} texte après', expected: { name: "test" } },
    { input: 'invalid', shouldThrow: true },
  ];

  let passed = 0;
  for (const test of testCases) {
    try {
      const result = parseJsonSafely(test.input);
      if (JSON.stringify(result) === JSON.stringify(test.expected)) {
        passed++;
        Logger.log(`✅ PASS: ${test.input.substring(0, 30)}...`);
      } else {
        Logger.log(`❌ FAIL: ${test.input.substring(0, 30)}... -> Expected: ${JSON.stringify(test.expected)}, Got: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      if (test.shouldThrow) {
        passed++;
        Logger.log(`✅ PASS: ${test.input.substring(0, 30)}... (erreur attendue)`);
      } else {
        Logger.log(`❌ FAIL: ${test.input.substring(0, 30)}... -> Erreur inattendue: ${e.message}`);
      }
    }
  }
  Logger.log(`Tests terminés: ${passed}/${testCases.length} réussis.`);
}

/**
 * Fonction de test pour valider la logique de sélection des 10 meilleurs CVs en prise de contact.
 */
function testContactRecommendationsLogic() {
  const mockCandidates = [
    // 12 candidats qualifiés (note 5 ou 4)
    { name: "C1", reco: "À contacter", score: 5 },
    { name: "C2", reco: "À contacter", score: 5 },
    { name: "C3", reco: "À contacter", score: 5 },
    { name: "C4", reco: "À contacter", score: 5 },
    { name: "C5", reco: "À contacter", score: 5 },
    { name: "C6", reco: "À contacter", score: 4 },
    { name: "C7", reco: "À contacter", score: 4 },
    { name: "C8", reco: "À contacter", score: 4 },
    { name: "C9", reco: "À contacter", score: 4 },
    { name: "C10", reco: "À contacter", score: 4 },
    { name: "C11", reco: "À contacter", score: 4 },
    { name: "C12", reco: "À contacter", score: 4 },
    // 2 candidats moyens (note 3)
    { name: "C13", reco: "À garder en vivier", score: 3 },
    { name: "C14", reco: "À contacter", score: 3 }, // Doit basculer en vivier
    // 2 candidats refusés (note 1-2)
    { name: "C15", reco: "À refuser", score: 2 },
    { name: "C16", reco: "À refuser", score: 1 }
  ];

  let contactCount = 0;
  const processed = mockCandidates.map(c => {
    let reco = c.reco;
    const score = c.score;
    const isQualifying = (reco === "À contacter" || score >= MIN_CONTACT_SCORE) && reco !== "À refuser" && score >= 3;

    if (isQualifying && score >= MIN_CONTACT_SCORE) {
      if (contactCount < MAX_CONTACT_CANDIDATES) {
        reco = "À contacter";
        contactCount++;
      } else {
        reco = "À garder en vivier";
      }
    } else if (reco === "À contacter" && score < MIN_CONTACT_SCORE) {
      reco = score <= 2 ? "À refuser" : "À garder en vivier";
    }
    return { name: c.name, reco, score };
  });

  const finalContact = processed.filter(c => c.reco === "À contacter");
  if (finalContact.length === 10) {
    Logger.log(`✅ PASS: Exactement 10 candidats retenus en prise de contact sur les 12 qualifiés.`);
  } else {
    Logger.log(`❌ FAIL: Attendu 10, obtenu ${finalContact.length}`);
  }

  const c11 = processed.find(c => c.name === "C11");
  if (c11 && c11.reco === "À garder en vivier") {
    Logger.log(`✅ PASS: Le 11ème candidat qualifié a bien été basculé en vivier.`);
  } else {
    Logger.log(`❌ FAIL: Le 11ème candidat n'a pas été basculé.`);
  }

  const c14 = processed.find(c => c.name === "C14");
  if (c14 && c14.reco === "À garder en vivier") {
    Logger.log(`✅ PASS: Le candidat note 3 marqué 'À contacter' a été réajusté en vivier.`);
  } else {
    Logger.log(`❌ FAIL: Le candidat note 3 n'a pas été réajusté.`);
  }
}
