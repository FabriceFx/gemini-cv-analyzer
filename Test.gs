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
 * Fonction de test pour valider la logique de sélection des 10 meilleurs CVs via computeContactRecommendations.
 */
function testContactRecommendationsLogic() {
  const mockCandidates = [
    // 12 candidats qualifiés (note 5 ou 4)
    { name: "C1", recommendation: "À contacter", score: 5 },
    { name: "C2", recommendation: "À contacter", score: 5 },
    { name: "C3", recommendation: "À contacter", score: 5 },
    { name: "C4", recommendation: "À contacter", score: 5 },
    { name: "C5", recommendation: "À contacter", score: 5 },
    { name: "C6", recommendation: "À contacter", score: 4 },
    { name: "C7", recommendation: "À contacter", score: 4 },
    { name: "C8", recommendation: "À contacter", score: 4 },
    { name: "C9", recommendation: "À contacter", score: 4 },
    { name: "C10", recommendation: "À contacter", score: 4 },
    { name: "C11", recommendation: "À contacter", score: 4 },
    { name: "C12", recommendation: "À contacter", score: 4 },
    // 2 candidats moyens (note 3)
    { name: "C13", recommendation: "À garder en vivier", score: 3 },
    { name: "C14", recommendation: "À contacter", score: 3 }, // Doit basculer en vivier
    // 2 candidats refusés (note 1-2)
    { name: "C15", recommendation: "À refuser", score: 2 },
    { name: "C16", recommendation: "À refuser", score: 1 }
  ];

  // Appel de la vraie fonction de production
  const newRecos = computeContactRecommendations(mockCandidates, 10, 4);

  const contactCount = newRecos.filter(r => r === "À contacter").length;
  if (contactCount === 10) {
    Logger.log("✅ PASS: Exactement 10 candidats retenus en prise de contact sur les 12 qualifiés.");
  } else {
    Logger.log(`❌ FAIL: Attendu 10, obtenu ${contactCount}`);
  }

  if (newRecos[10] === "À garder en vivier" && newRecos[11] === "À garder en vivier") {
    Logger.log("✅ PASS: Les 11e et 12e candidats qualifiés ont bien été basculés en vivier.");
  } else {
    Logger.log("❌ FAIL: Les candidats au-delà du 10e n'ont pas été basculés correctement.");
  }

  if (newRecos[13] === "À garder en vivier") {
    Logger.log("✅ PASS: Le candidat note 3 marqué 'À contacter' a été réajusté en vivier.");
  } else {
    Logger.log("❌ FAIL: Le candidat note 3 n'a pas été réajusté.");
  }

  // Test avec seulement 3 candidats qualifiés
  const sparseCandidates = [
    { recommendation: "À contacter", score: 5 },
    { recommendation: "À contacter", score: 4 },
    { recommendation: "À contacter", score: 4 },
    { recommendation: "À refuser", score: 2 },
    { recommendation: "À refuser", score: 1 }
  ];
  const sparseRecos = computeContactRecommendations(sparseCandidates, 10, 4);
  const sparseCount = sparseRecos.filter(r => r === "À contacter").length;
  if (sparseCount === 3) {
    Logger.log("✅ PASS: Cas < 10 qualifiés : exactement 3 candidats retenus sans repêchage artificiel.");
  } else {
    Logger.log(`❌ FAIL: Attendu 3, obtenu ${sparseCount}`);
  }
}

/**
 * Fonction de test pour valider la protection de l'Allowlist de domaines (anti-SSRF).
 */
function testIsDomainAllowed() {
  const allowed = "linkedin.com, indeed.com, pole-emploi.fr, francetravail.fr";
  const testCases = [
    { domain: "linkedin.com", expected: true },
    { domain: "www.linkedin.com", expected: true },
    { domain: "jobs.indeed.com", expected: true },
    { domain: "evil-linkedin.com", expected: false },
    { domain: "linkedin.com.evil.com", expected: false },
    { domain: "pole-emploi.fr", expected: true },
    { domain: "google.com", expected: false }
  ];

  let passed = 0;
  for (const test of testCases) {
    const result = isDomainAllowed(test.domain, allowed);
    if (result === test.expected) {
      passed++;
      Logger.log(`✅ PASS: ${test.domain} -> ${result}`);
    } else {
      Logger.log(`❌ FAIL: ${test.domain} -> Expected: ${test.expected}, Got: ${result}`);
    }
  }
  Logger.log(`Tests domaines terminés: ${passed}/${testCases.length} réussis.`);

  // Test de l'extraction de domaine et protection anti-contournement (appel direct de extractDomainFromUrl)
  const urlTestCases = [
    { url: "https://evil.example?x=.linkedin.com", expectedDomain: "evil.example", expectedAllowed: false },
    { url: "https://evil.example#linkedin.com", expectedDomain: "evil.example", expectedAllowed: false },
    { url: "https://user@evil.example/path", expectedDomain: null, expectedAllowed: false },
    { url: "https://linkedin.com@evil.example/offre", expectedDomain: null, expectedAllowed: false },
    { url: "https://www.linkedin.com/jobs/view/123456", expectedDomain: "linkedin.com", expectedAllowed: true },
    { url: "https://pole-emploi.fr/candidat/offre/123", expectedDomain: "pole-emploi.fr", expectedAllowed: true },
    { url: "https://jobs.indeed.com:443/viewjob?id=1", expectedDomain: "jobs.indeed.com", expectedAllowed: true }
  ];

  let urlPassed = 0;
  for (const tc of urlTestCases) {
    const domain = extractDomainFromUrl(tc.url);
    const domainMatchOk = domain === tc.expectedDomain;
    const allowedResult = domain ? isDomainAllowed(domain, allowed) : false;
    
    if (domainMatchOk && allowedResult === tc.expectedAllowed) {
      urlPassed++;
      Logger.log(`✅ PASS (URL check): ${tc.url} -> domaine: "${domain}" -> autorisé: ${allowedResult}`);
    } else {
      Logger.log(`❌ FAIL (URL check): ${tc.url} -> domaine obtenu: "${domain}" (attendu: "${tc.expectedDomain}") -> autorisé: ${allowedResult} (attendu: ${tc.expectedAllowed})`);
    }
  }
  Logger.log(`Tests URLs terminés: ${urlPassed}/${urlTestCases.length} réussis.`);
}

/**
 * Fonction de test pour valider la logique pure de mergeJobState.
 */
function testJobStateManagement() {
  const initial = {
    status: "IDLE",
    total: 0,
    processed: 0,
    successCount: 0,
    errorCount: 0,
    recentCandidates: []
  };

  const fixedTime = 1700000000000;
  const step1 = mergeJobState(initial, {
    status: "RUNNING",
    source: "sidebar",
    total: 20,
    currentFileName: "CV_1.pdf"
  }, fixedTime);

  const ok1 = step1.status === "RUNNING" && step1.source === "sidebar" && step1.total === 20 && step1.processed === 0 && step1.currentFileName === "CV_1.pdf" && step1.lastUpdated === fixedTime;

  const step2 = mergeJobState(step1, {
    processed: 5,
    successCount: 4,
    errorCount: 1,
    recentCandidates: [{ name: "Alice", score: 5, reco: "À contacter" }]
  }, fixedTime + 1000);

  const ok2 = step2.status === "RUNNING" && step2.source === "sidebar" && step2.total === 20 && step2.processed === 5 && step2.successCount === 4 && step2.errorCount === 1 && step2.recentCandidates.length === 1 && step2.lastUpdated === fixedTime + 1000;

  const step3 = mergeJobState(step2, {
    status: "COMPLETED",
    topContactCount: 3,
    currentFileName: "Terminé"
  }, fixedTime + 2000);

  const ok3 = step3.status === "COMPLETED" && step3.source === "sidebar" && step3.total === 20 && step3.processed === 5 && step3.topContactCount === 3 && step3.recentCandidates.length === 1;

  if (ok1 && ok2 && ok3) {
    Logger.log("✅ PASS: mergeJobState gère correctement l'accumulation, la source et la cohérence de l'état du job.");
  } else {
    Logger.log(`❌ FAIL: Erreur dans mergeJobState (ok1=${ok1}, ok2=${ok2}, ok3=${ok3})`);
  }
}


