# 🔍 Analyseur de CV IA - Google Sheets & Apps Script / AI resume analyzer - Google Sheets & Apps Script

Cet outil utilise l'API Gemini pour analyser automatiquement des CVs au format PDF déposés dans un dossier Google Drive, en les comparant à une offre d'emploi. Il évalue l'adéquation des profils, attribue une note sur 100 et extrait une décision ainsi que les forces et faiblesses clés. / This tool uses the Gemini API to automatically analyze PDF resumes placed in a Google Drive folder, comparing them to a job description. It evaluates candidate fit, assigns a score out of 100, and extracts a decision along with key strengths and weaknesses.

---

## 🚀 Guide d'installation et configuration / Installation and configuration guide

Suivez ces étapes simples pour déployer l'outil dans votre propre Google Sheet : / Follow these simple steps to deploy the tool in your own Google Sheet:

### Étape 1 : créer ou ouvrir une Google Sheet / Step 1: create or open a Google Sheet
1. Ouvrez [Google Sheets](https://sheets.google.com) et créez une nouvelle feuille de calcul vierge (ou ouvrez-en une existante). / Open [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet (or open an existing one).

### Étape 2 : accéder à l'éditeur Apps Script / Step 2: access the Apps Script editor
1. Dans le menu supérieur, cliquez sur **Extensions** > **Apps Script**. / In the top menu, click on **Extensions** > **Apps Script**.
2. Cela ouvre l'interface de développement de Google Apps Script liée à votre feuille de calcul. / This opens the Google Apps Script development interface linked to your spreadsheet.

### Étape 3 : configurer le manifeste (`appsscript.json`) / Step 3: configure the manifest (`appsscript.json`)
Par défaut, Google cache le fichier manifeste. Voici comment le rendre visible et le modifier : / By default, Google hides the manifest file. Here is how to make it visible and edit it:
1. Dans l'éditeur Apps Script, cliquez sur l'icône d'engrenage (⚙️) à gauche représentant les **Paramètres du projet**. / In the Apps Script editor, click the gear icon (⚙️) on the left representing the **Project settings**.
2. Cochez la case **"Afficher le fichier manifeste appsscript.json dans l'éditeur"**. / Check the box **"Show 'appsscript.json' manifest file in editor"**.
3. Revenez à l'éditeur (icône de code `< >`). Un nouveau fichier nommé `appsscript.json` est maintenant visible. / Go back to the editor (code icon `< >`). A new file named `appsscript.json` is now visible.
4. Cliquez sur `appsscript.json`, effacez tout son contenu, puis collez le code fourni dans le fichier [appsscript.json](appsscript.json) du projet. / Click on `appsscript.json`, delete all its content, then paste the code provided in the project's [appsscript.json](appsscript.json) file.

### Étape 4 : coller le code principal (`Code.gs`) / Step 4: paste the main code (`Code.gs`)
1. Dans l'éditeur, sélectionnez le fichier `Code.gs`. / In the editor, select the `Code.gs` file.
2. Effacez tout le code existant et remplacez-le par le contenu du fichier [Code.gs](Code.gs) de ce projet. / Delete all existing code and replace it with the content of this project's [Code.gs](Code.gs) file.
3. Enregistrez les modifications en cliquant sur l'icône de disquette (💾) ou en faisant `Cmd + S` (Mac) / `Ctrl + S` (Windows). / Save the changes by clicking the floppy disk icon (💾) or by pressing `Cmd + S` (Mac) / `Ctrl + S` (Windows).

### Étape 5 : initialiser les feuilles / Step 5: initialize the sheets
1. Retournez sur votre onglet Google Sheets et **rafraîchissez la page** (F5 / `Cmd + R`). / Go back to your Google Sheets tab and **refresh the page** (F5 / `Cmd + R`).
2. Après quelques secondes, un nouveau menu nommé **`🚀 Analyseur de CV`** apparaît à droite du menu "Aide". / After a few seconds, a new menu named **`🚀 Analyseur de CV`** appears to the right of the "Help" menu.
3. Cliquez sur **`🚀 Analyseur de CV`** > **`⚙️ Initialiser / Réinitialiser les feuilles`**. / Click on **`🚀 Analyseur de CV`** > **`⚙️ Initialiser / Réinitialiser les feuilles`**.
4. **Autorisation requise** : Une fenêtre Google va s'ouvrir pour vous demander d'autoriser le script. Cliquez sur "Continuer", sélectionnez votre compte Google, cliquez sur "Paramètres avancés" (en bas en petit), puis sur **"Accéder à [Nom du projet] (non sécurisé)"**, et enfin sur "Autoriser". / **Authorization required**: A Google window will open asking you to authorize the script. Click "Continue", select your Google account, click "Advanced" (at the bottom in small text), then **"Go to [Project Name] (unsafe)"**, and finally "Allow".
5. Cliquez à nouveau sur **`⚙️ Initialiser / Réinitialiser les feuilles`** pour finaliser la mise en place. Deux feuilles nommées `Configuration` et `Résultats de l'Analyse` vont être générées et stylisées. / Click again on **`⚙️ Initialiser / Réinitialiser les feuilles`** to finalize the setup. Two sheets named `Configuration` and `Résultats de l'Analyse` will be generated and styled.

### 💻 Alternative d'installation avec clasp (optionnel) / Installation alternative with clasp (optional)
Puisque vous utilisez **clasp** (la CLI Google Apps Script), un fichier `.clasp.json` a été configuré automatiquement à la racine de votre répertoire local avec l'identifiant de votre script (`14Y9xAehM1HO9A6DA9YIwmAphj4Tfqljbw5fTLuCNaxZH9vMFwQYRKWwt`). / Since you are using **clasp** (the Google Apps Script CLI), a `.clasp.json` file has been automatically configured at the root of your local directory with your script ID (`14Y9xAehM1HO9A6DA9YIwmAphj4Tfqljbw5fTLuCNaxZH9vMFwQYRKWwt`).

Pour pousser ce code local directement sur votre projet en ligne : / To push this local code directly to your online project:
1. Assurez-vous d'être connecté à clasp dans votre terminal : / Make sure you are logged into clasp in your terminal:
   ```bash
   clasp login
   ```
2. Envoyez les fichiers locaux (`Code.gs` et `appsscript.json`) : / Push local files (`Code.gs` and `appsscript.json`):
   ```bash
   clasp push
   ```
3. Suivez ensuite l'**étape 5** ci-dessus pour initialiser les feuilles dans votre Google Sheet. / Then follow **step 5** above to initialize the sheets in your Google Sheet.

---

## 🛠️ Utilisation quotidienne / Daily usage

Une fois l'initialisation terminée, l'analyse des candidatures se fait en 3 étapes rapides : / Once initialization is complete, candidate analysis is done in 3 quick steps:

1. **Obtenir une clé API Gemini** : Rendez-vous sur [Google AI Studio](https://aistudio.google.com/), générez une clé API gratuite. Ensuite, dans Google Sheets, allez dans le menu **`🚀 Analyseur de CV`** > **`🔑 Configurer la clé API`** et collez votre clé. Elle sera sauvegardée de façon sécurisée (invisible dans les cellules). / **Get a Gemini API key**: Go to [Google AI Studio](https://aistudio.google.com/), generate a free API key. Then, in Google Sheets, go to the menu **`🚀 Analyseur de CV`** > **`🔑 Configurer la clé API`** and paste your key. It will be saved securely (hidden from the cells).
2. **Dossier Google Drive** : Créez un dossier dans votre Google Drive, déposez-y tous les CVs de vos candidats au format PDF, et copiez l'URL de partage du dossier. Collez cette URL dans la cellule **B4**. / **Google Drive folder**: Create a folder in your Google Drive, drop all your candidates' PDF resumes into it, and copy the folder's shareable URL. Paste this URL into cell **B4**.
3. **L'offre d'emploi** : / **The job offer**: 
   * Copiez l'URL publique de l'annonce (par exemple de LinkedIn, Indeed ou d'un site de recrutement) et collez-la dans la cellule **B5**. / Copy the public URL of the job post (e.g. from LinkedIn, Indeed, or a recruitment site) and paste it into cell **B5**.
   * *Note : Si l'annonce est sur un espace privé ou protégée contre le scraping, copiez-collez simplement l'intégralité du texte de l'annonce directement dans la cellule **B5**.* / *Note: If the ad is on a private space or protected against scraping, simply copy-paste the entire text of the ad directly into cell **B5**.*
4. **Modèle** : Sélectionnez `gemini-3.5-flash` dans le menu déroulant (cellule **B6**) pour une analyse ultra-rapide et économique. / **Model**: Select `gemini-3.5-flash` from the dropdown menu (cell **B6**) for ultra-fast and cost-effective analysis.
5. **Démarrer l'analyse** : / **Start the analysis**:
   * Cliquez sur le menu **`🚀 Analyseur de CV`** > **`🔍 Analyser les nouveaux CVs`**. / Click on the **`🚀 Analyseur de CV`** > **`🔍 Analyser les nouveaux CVs`** menu.
   * Le script va scanner le dossier, ignorer les CVs déjà analysés pour éviter les doublons, et traiter les nouveaux candidats. / The script will scan the folder, skip already analyzed resumes to avoid duplicates, and process new candidates.
   * Vous pouvez suivre la progression en temps réel (des toasts s'affichent et le tableau de l'onglet `Résultats de l'Analyse` se remplit ligne par ligne). / You can track progress in real-time (toasts appear and the `Résultats de l'Analyse` tab table fills line by line).

---

## ✨ Fonctionnalités avancées / Advanced features

* **Reprise sur interruption** : Si le script s'arrête (limite des 6 minutes d'exécution de Google pour les comptes gratuits), relancez simplement la commande `🔍 Analyser les nouveaux CVs`. Le script passera les candidats déjà notés et se focalisera uniquement sur les nouveaux fichiers. / **Resume on interruption**: If the script stops (Google's 6-minute execution limit for free accounts), simply relaunch the `🔍 Analyser les nouveaux CVs` command. The script will skip already scored candidates and focus only on new files.
* **Critères personnalisés (cellule B7)** : Vous pouvez forcer l'IA à surveiller un aspect particulier. Ex: *"Chercher absolument de l'expérience avec React Native, être très sévère sur l'orthographe, et pénaliser l'absence de diplôme d'ingénieur"*. / **Custom criteria (cell B7)**: You can force the AI to look for a particular aspect. Ex: *"Absolutely look for React Native experience, be very strict on spelling, and penalize the lack of an engineering degree"*.
* **Hyperliens directs** : Dans le tableau des résultats, la colonne *Fichier CV* génère automatiquement un lien cliquable qui ouvre directement le PDF du candidat dans Google Drive dans un nouvel onglet. / **Direct hyperlinks**: In the results table, the *Resume file* column automatically generates a clickable link that directly opens the candidate's PDF in Google Drive in a new tab.
* **Mise en forme conditionnelle** : Le tableau colore automatiquement les lignes selon le niveau de recommandation (Vert pour les profils recommandés, Jaune pour étudier, Rouge pour les profils non retenus). / **Conditional formatting**: The table automatically colors rows according to the recommendation level (Green for recommended profiles, Yellow for studying, Red for rejected profiles).
