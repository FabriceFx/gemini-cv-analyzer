# 🔍 gemini-cv-analyzer

[🇫🇷 Français](#-français) | [🇬🇧 English](#-english)

---

## 🇫🇷 Français

**Un assistant de recrutement intelligent sur Google Sheets utilisant l'API Gemini.**

Cet outil utilise l'API Gemini pour analyser automatiquement des CVs (PDF, Google Docs et DOCX) déposés dans un dossier Google Drive, en les comparant à une offre d'emploi. Il évalue l'adéquation des profils, extrait les coordonnées, sélectionne les meilleurs profils en prise de contact (Top 10 max qualifiés avec note ≥ 4/5) et rédige automatiquement les brouillons d'emails de réponse. L'architecture est modularisée en 12 fichiers (11 scripts `.gs` et 1 fichier `.html`) pour une excellente maintenabilité.

### 🚀 Guide d'installation et configuration

#### Étape 1 : créer ou ouvrir une Google Sheet
1. Ouvrez [Google Sheets](https://sheets.google.com) et créez une nouvelle feuille de calcul vierge (ou ouvrez-en une existante).

#### Étape 2 : accéder à l'éditeur Apps Script
1. Dans le menu supérieur, cliquez sur **Extensions** > **Apps Script**.
2. Cela ouvre l'interface de développement de Google Apps Script liée à votre feuille de calcul.

#### Étape 3 : copier les fichiers `.gs` et `.html`
Le code source est organisé en 12 fichiers :
- **Fichiers Script (`.gs`)** : `Config.gs`, `Constants.gs`, `DriveService.gs`, `EmailService.gs`, `GeminiClient.gs`, `Main.gs`, `RGPD.gs`, `SidebarController.gs`, `Test.gs`, `UI.gs`, `Utils.gs`.
- **Fichier HTML (`.html`)** : `Sidebar.html` *(créé via **+** > **HTML** dans l'éditeur)*.

1. Dans l'éditeur Apps Script, créez un nouveau script pour chacun des fichiers `.gs` (icône **+** > **Script**).
2. Créez un fichier HTML nommé `Sidebar` (icône **+** > **HTML**).
3. Copiez-collez le code de chaque fichier correspondant depuis ce dépôt GitHub vers votre éditeur.
4. Enregistrez (`Cmd + S` / `Ctrl + S`).

*(Si vous préférez, vous pouvez utiliser la CLI `clasp` pour pousser tout le projet local d'un coup).*

#### Étape 4 : configurer le manifeste (`appsscript.json`)
1. Dans l'éditeur Apps Script, cliquez sur l'icône d'engrenage (⚙️) à gauche représentant les **Paramètres du projet**.
2. Cochez la case **"Afficher le fichier manifeste appsscript.json dans l'éditeur"**.
3. Revenez à l'éditeur, cliquez sur `appsscript.json`, effacez son contenu, puis collez le code fourni dans le fichier `appsscript.json` de ce dépôt.

#### Étape 5 : initialiser les feuilles
1. Retournez sur votre onglet Google Sheets et **rafraîchissez la page** (F5 / `Cmd + R`).
2. Après quelques secondes, un nouveau menu nommé **`🚀 Analyseur de CV`** apparaît à droite du menu "Aide".
3. Cliquez sur **`🚀 Analyseur de CV`** > **`⚙️ Initialiser / Réinitialiser les feuilles`**.
4. Autorisez l'exécution du script via les fenêtres d'avertissement Google (cliquez sur "Paramètres avancés" > "Accéder au projet (non sécurisé)").
5. Confirmez la boîte de dialogue pour finaliser la mise en place. Le classeur est configuré avec une structure épurée à **2 onglets** : `Résultats de l'analyse` et `Journal RGPD` (les paramètres de configuration sont directement stockés de manière invisible et pérenne dans les propriétés du document via la Sidebar).

> **🔄 Mise à jour depuis une version antérieure :** Si vous mettez à jour un projet existant, remplacez impérativement le fichier `appsscript.json` (qui active le service avancé Drive v2 pour la conversion automatique des DOCX et le scope `scriptapp` pour les déclencheurs) et ré-autorisez le script lors du premier lancement. Si une ancienne feuille `Configuration` était présente, ses données sont automatiquement migrées vers `DocumentProperties` lors de l'initialisation.

### 🛠️ Fonctionnalités et utilisation quotidienne

1. **Clé API Gemini** : 
   - Rendez-vous sur [Google AI Studio](https://aistudio.google.com/app/apikey) et connectez-vous avec votre compte Google.
   - Cliquez sur **"Create API Key"** (Créer une clé API) et créez-la dans un projet (Payant recommandé pour la stricte confidentialité des données RH).
   - Copiez la clé générée.
   - De retour dans Google Sheets, utilisez le menu **`🚀 Analyseur de CV`** > **`🔑 Configurer la clé API`** pour l'enregistrer de façon sécurisée dans `Script Properties` (elle n'est pas affichée dans la feuille).
2. **Panneau latéral de contrôle (Sidebar MD3)** :
   * Ouvrez le panneau via le menu **`🚀 Analyseur de CV`** > **`📂 Ouvrir le panneau de contrôle`**.
   * **Onglet ⚡ Lancer** : Renseignez l'URL du dossier Drive contenant vos CVs et l'annonce (texte ou URL), choisissez le modèle, personnalisez les options avancées (rétention RGPD, domaines autorisés, prompt système) et lancez l'analyse. Tous les réglages sont automatiquement sauvegardés dans le document.
   * **Onglet 📊 Suivi** : Visualisez en direct la barre de progression, le statut d'avancement et la liste des derniers profils analysés.
   * **Onglet 👤 Fiche Candidat** : Consultez la fiche enrichie d'un candidat (note / 5, forces, points de vigilance, extrait de compétences) via la liste déroulante ou le bouton de synchronisation **🔄**, avec accès direct au document Drive et rédaction instantanée d'un brouillon Gmail.
3. **Annonce** : Collez le texte de l'annonce ou son URL dans le formulaire de la Sidebar.
   - *Protection (SSRF) :* Le système vérifie que le domaine fait partie des **Domaines autorisés** configurés. Si l'URL est bloquée (ex: LinkedIn protégé contre le scraping), copiez-collez directement le texte.
4. **Modèle** : Sélectionnez `gemini-3.7-flash` (par défaut) pour le meilleur compromis rapidité, qualité de raisonnement et coût.
5. **Panneau latéral de contrôle (Sidebar MD3)** :
   * Ouvrez le panneau via le menu **`🚀 Analyseur de CV`** > **`📂 Ouvrir le panneau de contrôle`**.
   * **Onglet ⚡ Lancer** : Configurez et déclenchez l'analyse de façon asynchrone sans bloquer l'interface.
   * **Onglet 📊 Suivi** : Visualisez en direct la barre de progression, le statut d'avancement et la liste des derniers profils analysés.
   * **Onglet 👤 Fiche Candidat** : Consultez la fiche enrichie d'un candidat (note / 5, forces, points de vigilance, extrait de compétences) via la liste déroulante ou le bouton de synchronisation **🔄**, avec accès direct au document Drive et rédaction instantanée d'un brouillon Gmail.
6. **Traitements & Reprise automatique** :
   * **Levée de la limite des 6 minutes** : À l'approche du timeout (4m30s) ou en cas de coupure (chien de garde Watchdog), le système programme automatiquement un déclencheur temporaire et poursuit le traitement des lots sans interruption.
   * **Quotas de déclencheurs** : Notez que le temps cumulé d'exécution des déclencheurs Google Apps Script est plafonné à 90 min/jour pour les comptes personnels Gmail gratuits (@gmail.com) et à 6 h/jour pour les comptes professionnels Google Workspace.
   * **Prise de contact sélective (Top 10)** : L'algorithme trie les candidatures et propose en statut « À contacter » uniquement les meilleurs profils qualifiés (note ≥ 4/5, plafonné à 10 profils maximum, ou moins s'il y a moins de profils pertinents).
   * **Automatisation quotidienne** : Activez l'analyse automatique pour recevoir un e-mail récapitulatif chaque nuit à 02h00.

### ✨ Sécurité, Conformité RGPD & Éthique de l'IA

* **Confidentialité des données RH (Gratuit vs Payant)** : En palier gratuit, Google peut utiliser les requêtes pour l'entraînement de ses modèles. **Pour un usage professionnel en conformité RGPD, utilisez un compte Payant (Pay-as-you-go)** dans Google AI Studio afin de garantir la non-conservation et la stricte confidentialité des CVs traités.
* **Non-discrimination & Biais** : Le prompt système intègre une directive formelle de non-discrimination ordonnant à l'IA d'ignorer toute donnée d'âge, genre, photo, adresse postale ou nationalité, pour se concentrer uniquement sur les compétences objectives.
* **Supervision humaine & Protection contre l'injection de prompt** : Les emails sont générés en tant que **brouillons Gmail non envoyés**. L'humain reste toujours décisionnaire final avant tout envoi. L'interface Web Sidebar est entièrement immunisée contre les attaques XSS par injection de prompt grâce à un rendu DOM sécurisé (`textContent`).
* **Nettoyage RGPD & Pseudonymisation** : Paramétrez votre délai de rétention. Le menu `🛡️ Nettoyage RGPD` met à la corbeille Drive les documents expirés et pseudonymise les colonnes d'identification (Nom, Email, Téléphone) dans le tableur.
* **En-tête API sécurisé** : Les appels API utilisent l'en-tête `x-goog-api-key` pour éliminer tout risque d'exposition de token dans les URLs ou les logs d'exécution.

---

## 🇬🇧 English

**An AI-powered recruitment assistant built on Google Sheets using the Gemini API.**

This tool uses the Gemini API (defaulting to `gemini-3.7-flash`) to automatically analyze PDF, DOCX, and Google Docs resumes placed in a Google Drive folder, comparing them to a job description. It evaluates candidate fit, extracts contact information, selects up to the top 10 qualified candidates (score ≥ 4/5) for contact interviews, and automatically drafts personalized response emails in Gmail. The codebase is modularized into 12 files (11 `.gs` scripts and 1 `.html` file) for easy maintenance.

### Key Highlights:
- **Interactive Control Sidebar**: Material Design 3 sidebar with real-time progress bar, live polling, form configuration, and rich candidate profile cards with prompt-injection-safe DOM rendering.
- **6-Minute Timeout Bypass**: Automatically schedules self-resuming triggers with watchdog guards to process large volumes of CVs seamlessly without hitting Google Apps Script execution time limits (subject to Google trigger limits: 90 min/day on free accounts, 6h/day on Workspace).
- **Enterprise-ready Privacy**: Recommends Paid (Pay-as-you-go) Gemini API for confidential data handling complying with GDPR.
- **Fair & Objective AI**: Enforces anti-bias / non-discrimination directives in system prompts.
- **Human in the loop**: All emails are prepared as Gmail drafts to ensure review and protect against adversarial prompt injections in CVs.
- **Selective Contact Top 10**: Caps active interview suggestions to the top 10 qualified profiles without artificial promotion.

*(Please refer to the French documentation above for setup instructions, translating the steps via your preferred tool. The interface inside the Google Sheet is generated in French).*
