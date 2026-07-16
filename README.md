# 🔍 gemini-cv-analyzer

[🇫🇷 Français](#-français) | [🇬🇧 English](#-english)

---

## 🇫🇷 Français

**Un assistant de recrutement intelligent sur Google Sheets utilisant l'API Gemini.**

Cet outil utilise l'API Gemini pour analyser automatiquement des CVs au format PDF et DOCX déposés dans un dossier Google Drive, en les comparant à une offre d'emploi. Il évalue l'adéquation des profils, extrait les coordonnées, et rédige automatiquement les brouillons d'emails de réponse. L'architecture a été modularisée en 10 fichiers pour une meilleure maintenabilité.

### 🚀 Guide d'installation et configuration

#### Étape 1 : créer ou ouvrir une Google Sheet
1. Ouvrez [Google Sheets](https://sheets.google.com) et créez une nouvelle feuille de calcul vierge (ou ouvrez-en une existante).

#### Étape 2 : accéder à l'éditeur Apps Script
1. Dans le menu supérieur, cliquez sur **Extensions** > **Apps Script**.
2. Cela ouvre l'interface de développement de Google Apps Script liée à votre feuille de calcul.

#### Étape 3 : copier les fichiers `.gs`
Le code source est organisé en plusieurs fichiers `.gs` :
- `Constants.gs`, `Config.gs`, `DriveService.gs`, `EmailService.gs`, `GeminiClient.gs`, `Main.gs`, `RGPD.gs`, `Test.gs`, `UI.gs`, `Utils.gs`.
1. Dans l'éditeur Apps Script, créez un nouveau script pour chacun de ces fichiers (icône **+** > **Script**).
2. Copiez-collez le code de chaque fichier correspondant depuis ce dépôt GitHub vers votre éditeur.
3. Enregistrez (`Cmd + S` / `Ctrl + S`).

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
5. Cliquez à nouveau sur le menu pour finaliser la mise en place. Les feuilles `Configuration`, `Résultats de l'analyse` et `Journal RGPD` vont être générées.

### 🛠️ Fonctionnalités et utilisation quotidienne

1. **Clé API Gemini** : 
   - Rendez-vous sur [Google AI Studio](https://aistudio.google.com/app/apikey) et connectez-vous avec votre compte Google.
   - Cliquez sur **"Create API Key"** (Créer une clé API) et créez-la dans un nouveau projet.
   - Copiez la clé générée (elle commence souvent par `AIza...`).
   - De retour dans Google Sheets, utilisez le menu **`🚀 Analyseur de CV`** > **`🔑 Configurer la clé API`** pour l'enregistrer de façon sécurisée (elle n'est pas affichée dans la feuille).
2. **Dossier de CVs** : Collez l'URL de partage de votre dossier Google Drive (contenant les PDF et DOCX) dans la cellule **B4**.
3. **Annonce** : Collez le texte de l'annonce ou son URL dans la cellule **B5**. 
   - *Sécurité (SSRF) :* Le système vérifie que le domaine fait partie des **Domaines autorisés** (définis dans la configuration). Si l'URL est bloquée ou s'il s'agit d'un site complexe (LinkedIn), copiez-collez manuellement le texte.
4. **Modèle** : Sélectionnez `gemini-3.5-flash` pour le meilleur compromis rapidité/coût.
5. **Traitements** :
   * **Scanner le dossier** : Lancez l'analyse groupée depuis le menu pour tous les nouveaux CVs. Les documents sont automatiquement divisés en sous-lots optimisés.
   * **Test rapide** : Utilisez le menu "Analyser un seul CV" en fournissant l'URL d'un seul document.
   * **Automatisation** : Activez l'analyse quotidienne depuis le menu pour recevoir un e-mail avec les résultats générés automatiquement chaque nuit.

### ✨ Sécurité, Conformité RGPD & Outils Avancés

* **Robustesse** : Le système gère intelligemment les erreurs serveur de l'API (Retry sur HTTP 500/503), parse le JSON de façon hautement sécurisée (ignorant les balises Markdown) et valide les emails générés.
* **Nettoyage RGPD** : Paramétrez votre délai de rétention. Le menu `🛡️ Nettoyage RGPD` placera les documents expirés dans la corbeille Drive et anonymisera les lignes dans le tableur ("Nom", "Email", "Téléphone") tout en générant un log d'audit dans `Journal RGPD`.
* **Context Caching** : Pour l'analyse de gros volumes de CV avec de longues descriptions de poste, l'outil utilise nativement le Context Caching de Gemini, réduisant considérablement vos coûts d'API.
* **Génération de brouillons** : Le script peut préparer dans votre boîte Gmail des e-mails hautement personnalisés pour accepter (proposer un entretien) ou refuser poliment vos candidats, en se basant sur leurs forces et faiblesses.

---

## 🇬🇧 English

**An AI-powered recruitment assistant built on Google Sheets using the Gemini API.**

This tool uses the Gemini API to automatically analyze PDF and DOCX resumes placed in a Google Drive folder, comparing them to a job description. It evaluates candidate fit, extracts contact information, and automatically drafts response emails. The codebase has been modularized into 9 files for easier maintenance.

*(Please refer to the French documentation above for setup instructions, translating the steps via your preferred tool. The interface inside the Google Sheet is generated in French).*
