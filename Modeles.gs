/**
 * Modeles.gs — la liste des modèles Gemini, demandée à Google. Introduit en v1.0.1.
 *
 * Pourquoi : les modèles Gemini changent tous les quelques mois. Une liste
 * écrite dans le code proposait des modèles retirés et ignorait les nouveaux,
 * et un modèle retiré faisait échouer chaque CV d'une erreur 404 illisible.
 *
 * Désormais :
 *   - la liste vient de `models.list`, filtrée sur les modèles qui génèrent du
 *     texte, et se garde six heures en cache (le maximum de CacheService) ;
 *   - la liste fixe de Constants.gs ne sert plus que de secours, et le panneau
 *     dit laquelle il affiche ;
 *   - le modèle enregistré n'est jamais remplacé en silence : changer de modèle
 *     fait réanalyser tous les CV. S'il a disparu, le panneau le dit ;
 *   - un modèle retiré arrête l'analyse au premier CV, avec un message qui dit
 *     quoi faire, au lieu de mettre chaque CV en erreur.
 */

const CLE_CACHE_MODELES_ = 'CV_ANALYZER_MODELES';

/**
 * Variantes que l'outil ne peut pas utiliser pour lire un CV : génération
 * d'images ou de son, temps réel, embeddings. Elles déclarent pourtant
 * `generateContent`.
 */
const VARIANTES_EXCLUES_ = /(embedding|image|tts|audio|live|aqa|learnlm|robotics|computer-use)/i;

/** Modèles de génération de texte rendus par Google, paginés, sans le préfixe « models/ ». */
const listerModelesGoogle_ = (apiKey) => {
  const modeles = [];
  let jeton = '';
  for (let page = 0; page < 10; page++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${jeton ? `&pageToken=${encodeURIComponent(jeton)}` : ''}`;
    const reponse = UrlFetchApp.fetch(url, { method: 'get', headers: { 'x-goog-api-key': apiKey }, muteHttpExceptions: true });
    if (reponse.getResponseCode() !== 200) {
      throw new Error(`liste des modèles refusée par Google (HTTP ${reponse.getResponseCode()})`);
    }
    const corps = JSON.parse(reponse.getContentText());
    (corps.models || []).forEach((m) => {
      const nom = String(m.name || '').replace(/^models\//, '');
      const methodes = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      if (nom.startsWith('gemini') && methodes.includes('generateContent') && !VARIANTES_EXCLUES_.test(nom)) {
        modeles.push(nom);
      }
    });
    jeton = corps.nextPageToken || '';
    if (!jeton) break;
  }
  return [...new Set(modeles)].sort(comparerModeles_);
};

/** Numéro de version d'un nom de modèle : « gemini-3.7-flash » → [3, 7]. */
const versionModele_ = (nom) => (String(nom).match(/gemini-(\d+(?:\.\d+)*)/) || [null, '0'])[1].split('.').map(Number);

/** Plus récent d'abord ; à version égale, ordre alphabétique. */
const comparerModeles_ = (a, b) => {
  const va = versionModele_(a);
  const vb = versionModele_(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] || 0) - (va[i] || 0);
    if (d !== 0) return d;
  }
  return a.localeCompare(b);
};

/**
 * Modèle proposé à un classeur neuf : le « flash » stable le plus récent (ni
 * « lite », ni préversion, ni expérimental). À défaut, le premier de la liste.
 */
const modeleParDefaut_ = (modeles) => {
  const stables = modeles.filter((m) => /flash/.test(m) && !/(lite|preview|exp)/.test(m));
  return stables[0] || modeles[0] || MODELE_PAR_DEFAUT;
};

/**
 * Liste à proposer, et d'où elle vient.
 * @returns {{modeles: string[], source: string, defaut: string, erreur: string}}
 */
const modelesDisponibles_ = () => {
  const cache = CacheService.getScriptCache();
  const enCache = cache.get(CLE_CACHE_MODELES_);
  if (enCache) {
    try {
      const modeles = JSON.parse(enCache);
      if (Array.isArray(modeles) && modeles.length > 0) {
        return { modeles, source: 'google', defaut: modeleParDefaut_(modeles), erreur: '' };
      }
    } catch (e) {
      Logger.log(`Cache des modèles illisible : ${e.message}`);
    }
  }
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { modeles: [...AVAILABLE_MODELS], source: 'secours', defaut: MODELE_PAR_DEFAUT, erreur: 'clé API non configurée' };
  }
  try {
    const modeles = listerModelesGoogle_(apiKey);
    if (modeles.length === 0) throw new Error('Google n\'a rendu aucun modèle de texte');
    cache.put(CLE_CACHE_MODELES_, JSON.stringify(modeles), 21600);
    return { modeles, source: 'google', defaut: modeleParDefaut_(modeles), erreur: '' };
  } catch (e) {
    Logger.log(`Liste des modèles indisponible : ${e.message}`);
    return { modeles: [...AVAILABLE_MODELS], source: 'secours', defaut: MODELE_PAR_DEFAUT, erreur: e.message };
  }
};

/** Message d'un modèle retiré ou inconnu de Google, qui dit quoi faire. */
const messageModeleIndisponible_ = (model) => `Le modèle « ${model} » n'est pas disponible chez Google (retiré, ou nom inconnu). `
  + 'Choisissez-en un autre dans le panneau, options avancées : la liste y est tenue à jour depuis Google. '
  + 'Changer de modèle fait réanalyser les CV.';
