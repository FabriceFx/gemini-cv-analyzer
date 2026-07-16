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
