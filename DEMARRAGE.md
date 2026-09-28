# Démarrage

Prérequis : une clé d'API Gemini, créée dans un **projet facturé** de Google AI
Studio (en palier gratuit, Google peut réutiliser les CV envoyés).

Principe d'organisation : **1 offre = 1 dossier Drive = 1 classeur**.

## 1. Installer

1. Créez un classeur Google Sheets, puis **Extensions > Apps Script** (le projet doit être lié au classeur).
2. Supprimez le `Code.gs` par défaut.
3. Recréez chaque fichier `.gs` du dépôt sous le même nom (**+ > Script**), et `Sidebar` (**+ > HTML**), puis collez leur contenu.
   Avec clasp : `clasp push` depuis le dossier du dépôt ; `.claspignore` n'envoie que le code, pas le banc d'essai.
4. **Paramètres du projet** : cochez « Afficher le fichier manifeste », puis collez `appsscript.json`.
5. Rechargez le classeur : le menu **🚀 Analyseur de CV** apparaît.
6. **🔑 Configurer la clé API** : collez la clé Gemini.
7. **⚙️ Initialiser / réinitialiser les feuilles** : crée les onglets « Résultats de l'analyse » et « Grille d'évaluation ». Autorisez les portées demandées (détail dans le [README](README.md#portées-demandées)).

## 2. Préparer la campagne

1. **📂 Ouvrir le panneau de contrôle**, onglet ⚡ Lancer.
2. Collez l'URL du dossier Drive des CV et l'annonce (texte, ou URL d'un domaine autorisé).
3. **✨ Proposer** : Gemini tire de l'annonce 5 à 10 critères et les écrit dans l'onglet « Grille d'évaluation ».
4. **Relisez la grille.** C'est l'étape qui fait la pertinence des résultats.

| Colonne | Ce qu'il faut y mettre |
|---|---|
| Critère | Un élément vérifiable sur un CV : compétence, expérience et sa durée, diplôme, langue, outil. Pas de savoir-être invérifiable. |
| Niveau | **Indispensable** seulement si l'on ne contacterait personne sans l'avoir vérifié : un CV qui ne le démontre pas reste au mieux en vivier, « à vérifier ». Sinon Important ou Souhaitable. |
| Poids | Vide : 3, 2 ou 1 selon le niveau. |
| Précisions | Ce qui aide à trancher : « 3 ans minimum », « Vue.js ou React acceptés ». |

5. Facultatif : **Consignes d'évaluation** (« une alternance compte comme expérience »), et la carte **⚖️ Sélection** : seuil de contact (70), seuil de vivier (40), places (10).

## 3. Analyser

**🚀 Lancer l'analyse** (panneau) ou **🔍 Analyser les nouveaux CV** (menu).
L'analyse s'interrompt avant la limite de 6 minutes et reprend seule une
minute plus tard ; vous pouvez fermer le classeur. L'onglet 📊 Suivi montre
l'avancement.

## 4. Lire les résultats

| Colonne | Ce qu'elle dit |
|---|---|
| Recommandation | Proposition de l'outil, recalculée à chaque classement. |
| Score / 100 | Vide : non mesuré (erreur, ou CV à réanalyser). |
| Motif de la recommandation | Pourquoi : seuil, indispensable manquant, rang au-delà des places, doublon. |
| Décision RH | **La vôtre.** L'outil ne l'écrit jamais ; elle prime pour les brouillons. |
| Doublon | Même email ou téléphone : une seule fiche classée. « À vérifier » : présomption, rien n'est écarté. |
| Détail du score | ✔ satisfait, ◐ partiel, ✘ non démontré, avec l'extrait du CV, puis le calcul. |

Survolez les en-têtes : chaque note dit d'où vient la colonne. Vous pouvez
ajouter vos propres colonnes (commentaires…) : l'outil n'y écrit pas, et elles
suivent le candidat quand l'onglet est trié.

## 5. Ajuster

| Vous changez | Faites |
|---|---|
| Un niveau, un poids, un seuil, le nombre de places ; vous retirez un critère | **🔁 Recalculer le classement** : immédiat, sans appel à Gemini |
| Vous ajoutez ou reformulez un critère, changez l'annonce, les consignes ou le modèle | **Lancer l'analyse** : seuls les CV concernés, marqués « À réanalyser », repartent |

## 6. Répondre aux candidats

**📧 Générer les emails de réponse** crée des **brouillons Gmail** : invitations
pour « À contacter », réponses négatives pour « À refuser ». La colonne
« Décision RH » prime ; un autre texte que les trois décisions (« Entretien le
12/10 ») veut dire « je m'en occupe ». Le décompte exact de ce qui sera créé, et
de ce qui est écarté, s'affiche avant de confirmer.

Un seul brouillon par adresse, jamais deux fois : la date s'inscrit dans
« Brouillon créé le ». Effacez-la pour en obtenir un nouveau. Relisez chaque
brouillon avant envoi.

## Mise à jour depuis une version non numérotée

1. Remplacez tous les fichiers ; ajoutez `Grille.gs`, `Classement.gs`, `Resultats.gs` ; **supprimez `Test.gs`**.
2. Au premier lancement, l'onglet Résultats est mis à niveau : les colonnes de l'ancien modèle (« Top 3 compétences », « Note / 5 ») sont supprimées, les nouvelles s'ajoutent à droite. Pour repartir d'un onglet neuf, dans l'ordre de colonnes de la v1, préférez **⚙️ Initialiser / réinitialiser les feuilles** : il efface toutes les lignes, décisions RH comprises.
3. Proposez puis relisez la grille, puis lancez l'analyse : **tous les CV sont réanalysés une fois** (un appel Gemini chacun), puisqu'ils avaient été évalués sans grille.
4. Si vous aviez modifié la colonne « Recommandation » à la main, reportez vos décisions dans « Décision RH ».

## En cas de souci

| Situation | Que faire |
|---|---|
| « La grille d'évaluation est vide » | Panneau : ✨ Proposer, relisez, relancez. |
| « La grille d'évaluation est à corriger » | Le message nomme la ligne : niveau vide ou inconnu, poids invalide, critère en double. |
| Moins de « À contacter » que de places | Normal : seuls les CV au-dessus du seuil sont proposés. Le bilan le dit. |
| Un CV reste « Erreur » | Le motif dit pourquoi ; il est retenté à chaque lancement. |
| Beaucoup de « À réanalyser » après une retouche | Vous avez ajouté ou reformulé un critère, ou changé l'annonce, les consignes ou le modèle : lancez l'analyse. |
| « Annonce … au-delà des 9 Ko » | Retirez la présentation de l'entreprise, ou donnez l'URL de l'annonce. |
| « Programmé » qui dure | C'est Google qui lance l'analyse : de quelques secondes à quelques minutes. Au-delà de 3 minutes, le panneau le signale ; **Apps Script › Exécutions** montre si `_resumeAnalysisTrigger` a tourné, et son message d'erreur (quota quotidien des déclencheurs, par exemple). |
| « Une autre opération occupe l'outil » | Un recalcul, des brouillons ou une proposition de grille sont en cours : l'analyse réessaie seule chaque minute, pendant un quart d'heure. |
| Analyse qui semble bloquée | Onglet 📊 Suivi : **🔄 Débloquer / Réinitialiser l'état**, puis relancez. |
