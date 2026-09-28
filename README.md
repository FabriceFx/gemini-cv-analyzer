# 🔍 gemini-cv-analyzer

[Français](#français) · [English](#english)

<a name="français"></a>
## Français

Assistant de recrutement dans Google Sheets. Il lit les CV (PDF, Google Docs,
DOCX) déposés dans un dossier Drive, les évalue avec Gemini au regard de
l'annonce et d'une **grille de critères fixée par l'équipe RH**, calcule un
score sur 100, propose « À contacter », « À garder en vivier » ou « À refuser »
avec son motif, écarte les doublons et prépare les brouillons de réponse dans
Gmail.

Pour l'installer et s'en servir, voir **[DEMARRAGE.md](DEMARRAGE.md)**.

### Comment un CV est évalué

| Étape | Qui | Quoi |
|---|---|---|
| 1. Grille | l'équipe RH | critères vérifiables sur un CV, avec niveau et poids ; l'outil peut la proposer à partir de l'annonce |
| 2. Constat | Gemini | pour chaque critère : Satisfait, Partiel ou Non démontré, et l'extrait du CV qui le justifie |
| 3. Score | le code | 100 × Σ(poids × valeur) ÷ Σ(poids), avec Satisfait = 1, Partiel = 0,5, Non démontré = 0 |
| 4. Classement | le code | seuils, indispensables, doublons, places ; puis tri de l'onglet |
| 5. Décision | l'équipe RH | colonne « Décision RH », jamais écrite par l'outil |

### Ce qui décide la recommandation

| Recommandation | Condition |
|---|---|
| À refuser | score sous le seuil de vivier (40) |
| À garder en vivier | un indispensable que le CV ne démontre pas, ou seulement en partie (« à vérifier »), ou score sous le seuil de contact (70), ou rang au-delà des places |
| À contacter | score au moins égal au seuil de contact, indispensables démontrés, dans la limite des places (10) |
| Doublon | autre CV de la même personne ; seule la fiche la mieux notée est classée |
| À réanalyser | évalué avec une autre annonce, d'autres consignes, un autre prompt, un autre modèle, ou avant l'ajout d'un critère |

Les seuils et le nombre de places se règlent dans le panneau. Les places sont
un **maximum** : l'outil ne complète jamais.

### Doublons

| Situation | Effet |
|---|---|
| Même email, ou même téléphone (« 06… », « +33 6… » se valent) | seule la fiche la mieux notée est classée ; les autres passent « Doublon » |
| Même email ou téléphone, mais noms différents | « À vérifier » (cabinet de recrutement, adresse partagée) ; rien n'est écarté |
| Même nom, aucune coordonnée commune | « À vérifier » ; rien n'est écarté |
| « Non renseigné » | ne relie personne |

### Ce qui coûte une réanalyse

| Changement | Effet |
|---|---|
| Niveau, poids, seuils, places ; critère retiré | recalcul immédiat (« Recalculer le classement »), sans appel à Gemini |
| Critère ajouté ou reformulé, précisions modifiées | les CV passent « À réanalyser », puis le sont au lancement suivant |
| Annonce, consignes, prompt ou modèle modifiés | idem |

### Choix de conception

| Choix | Pourquoi |
|---|---|
| L'IA constate, le code note. | Deux CV jugés sur les mêmes critères se comparent ; une note globale de 1 à 5 ne départageait rien. |
| Chaque statut porte un extrait du CV. | Un score qui ne sait pas dire d'où il vient ne survit pas à la première contestation. |
| Le niveau et le poids ne sont pas montrés à l'IA. | Elle constate sans indulgence, et l'on peut les changer sans réanalyser. |
| Seuils absolus, places en maximum. | « Top 10 » voulait dire « toujours 10 » ; l'équipe RH n'en voulait que les bons. |
| Un indispensable absent du CV plafonne au vivier, sans refuser. | Un CV muet sur un point n'est pas un candidat qui en manque ; refuser là-dessus prendrait une présomption pour un fait. |
| Un fait et une présomption dans deux cases. | Même email : doublon. Même nom : « À vérifier ». Un homonyme n'est pas écarté. |
| « Décision RH » n'est jamais écrite par le code. | La proposition de l'outil se recalcule ; la décision humaine, non. |
| Colonnes retrouvées par leur en-tête. | Une colonne ajoutée par l'équipe ne décale aucune écriture. |
| Réanalyse sur la ligne existante. | La décision RH, la date de brouillon et les colonnes de l'équipe restent attachées au candidat. |
| Un brouillon daté aussitôt créé, un seul par adresse. | Une génération interrompue se relance sans doublon ; une même personne ne reçoit pas invitation et refus. |
| Liste des modèles demandée à Google, jamais changée en silence. | Les modèles Gemini changent tous les quelques mois ; changer de modèle fait réanalyser tous les CV. |
| Annonce par URL lue une seule fois. | Tous les CV d'une campagne sont comparés à la même annonce. |
| Texte venu d'un CV forcé en texte. | Un « nom » `=IMAGE(…)` ferait sortir le contenu du classeur. |
| Projet lié au classeur. | Chaque action manuelle s'exécute sous l'identité de qui clique. |

### Portées demandées

| Portée | Pour quoi faire |
|---|---|
| `spreadsheets.currentonly` | ce classeur-ci, et aucun autre |
| `drive` | lire les CV du dossier, convertir les DOCX (copie temporaire), mettre les CV expirés à la corbeille |
| `script.external_request` | appeler Gemini, lire une annonce par URL (domaines autorisés seulement) |
| `script.container.ui` | menu, panneau, boîtes de dialogue |
| `script.scriptapp` | reprise automatique, analyse quotidienne |
| `gmail.compose` | créer des **brouillons** ; aucun email n'est envoyé aux candidats |
| `script.send_mail` | vous prévenir de la fin ou de l'échec d'une analyse automatique |

### Confidentialité

En palier gratuit, Google peut réutiliser les requêtes. Pour des CV, utilisez
une clé d'un **projet facturé**. La synthèse de session ne transmet que des
scores, sans nom. Le nettoyage RGPD met à la corbeille les CV plus anciens que
le délai de rétention et pseudonymise leurs lignes, extraits compris.

### Structure

```
Constants.gs          version, en-têtes, libellés, prompt par défaut
Config.gs             réglages (DocumentProperties), prompt effectif, annonce de référence
Modeles.gs            liste des modèles lue chez Google, défaut, modèle retiré
Grille.gs             onglet de la grille, proposition par Gemini, schéma, empreintes
Classement.gs         score, recommandation, doublons, places, tri
Resultats.gs          lecture et écriture de l'onglet Résultats par en-tête
GeminiClient.gs       appels Gemini, lecture et contrôle des réponses
Main.gs               analyse en lots, reprise automatique, CV unique
EmailService.gs       brouillons Gmail
SidebarController.gs  pont avec le panneau
Sidebar.html          panneau latéral
UI.gs                 menu, initialisation, guide, « À propos »
RGPD.gs               nettoyage et pseudonymisation
DriveService.gs       identifiant d'un dossier
Utils.gs              analyse JSON, normalisations, empreinte SHA-256
banc/                 banc d'essai hors Google (non poussé par clasp)
```

### Banc d'essai

```bash
node banc/test.js
```

Les `.gs` sont chargés dans un contexte Node où Sheets, Drive et Gemini sont
simulés, aussi stricts que les vrais : formules, nombres et dates interprétés
comme Sheets, 9 Ko par propriété, octets signés, schéma Gemini vérifié,
horloge simulée pour les reprises. Le banc exécute aussi le script du panneau
contre les vraies fonctions serveur.

Réintroduire un défaut doit faire échouer le banc :

| Défaut à réintroduire | Cas qui doit échouer |
|---|---|
| Compléter les places avec le vivier | Les places sont un maximum |
| Écrire tel quel un texte venu d'un CV | Formules : toute chaîne venue d'un CV est neutralisée |
| Empreinte du référentiel sans préfixe `r1-` | Empreinte du référentiel : jamais numérique |
| Ignorer les prompts historiques | Le prompt par défaut figé est reconnu |
| Accepter « Non renseigné » comme email | Clés d'identité / « Non renseigné » ne relie personne |
| Ne pas dater le brouillon | Brouillons : jamais refaits |
| Plusieurs brouillons par adresse | Brouillons : un par adresse |
| Constante globale lisant un autre fichier | Chargement quel que soit l'ordre des fichiers |
| Échec de réanalyse qui réécrit toute la ligne | Réanalyse en échec : la ligne garde le nom |
| Fiche retenue = la moins bien notée | Un doublon ne prend pas de place |
| Adresse de cabinet prise pour une personne | Une adresse partagée n'écarte personne |
| Onglet non trié | Analyse complète : … et tri |
| Noms envoyés dans la synthèse | Analyse complète : aucun nom dans la synthèse |
| Ligne active lue sur un autre onglet | Panneau : candidats désignés par leur fichier |
| Langue illisible non absorbée dans `onOpen` | Menu construit même quand la langue est illisible |
| Réponse incomplète comptée « non démontré » | Analyse complète : erreurs |
| Ex æquo tranché sans le dire | Places : ex æquo départagé et dit |
| Critère retiré qui oblige à réanalyser | Critère retiré = rien à refaire |
| Seuil de contact exclusif | Recommandation par seuils absolus |
| `muteHttpExceptions` retiré de la lecture d'annonce | Une annonce en 403 donne le message prévu |
| Indispensable absent du CV qui refuse | Un indispensable absent du CV plafonne au vivier |
| Colonnes de l'ancien modèle laissées en place | Mise à niveau d'un classeur v0 |
| Démarrage qui repart en silence, verrou pris | Déclencheur arrivé pendant une autre opération |
| Chien de garde posé hors du `try` | Chien de garde impossible à poser |
| Erreur 404 d'un modèle retiré laissée à chaque CV | Modèle retiré : l'analyse s'arrête au premier lot |
| Modèle enregistré remplacé par le défaut | Un modèle enregistré qui a disparu reste choisi |
| Nettoyage RGPD sans verrou | RGPD : pas de nettoyage pendant une autre opération |

Avant de pousser :

```bash
cat *.gs > /tmp/projet.js && node --check /tmp/projet.js && node banc/test.js
```

### Licence

[Elastic License 2.0](LICENSE) — Fabrice Faucheux ([faucheux.bzh](https://faucheux.bzh)).

---

<a name="english"></a>
## English

A recruitment assistant in Google Sheets. It reads CVs (PDF, Google Docs,
DOCX) from a Drive folder, evaluates them with Gemini against the job ad and an
**evaluation grid set by the HR team**, computes a score out of 100, proposes
« contact », « talent pool » or « reject » with its reason, sets duplicates
aside and prepares reply drafts in Gmail.

- **Gemini states, the code scores.** For each criterion of the grid, Gemini
  returns Satisfied, Partial or Not shown, with a quote from the CV; the score
  is a weighted average computed in code, and every row shows its calculation.
- **Absolute thresholds, seats as a maximum.** Only candidates above the
  contact threshold, with every must-have criterion shown, are proposed, and
  never more than the number of seats — never padded up to it. A must-have the
  CV does not mention keeps it in the talent pool, flagged « à vérifier »: a CV
  silent on a point is not a candidate lacking it. Rejection comes from the
  score alone.
- **One row per person.** Same email or same phone: one CV is ranked, the
  others are marked « Doublon ». Same name only, or a contact shared by
  different names (a recruitment agency): flagged for review, nothing removed.
- **The HR decision column is never written by the code** and drives the
  email drafts. One draft per address, never twice.
- **Changing weights, levels or thresholds costs nothing**: « Recalculer le
  classement » re-ranks without calling Gemini. Adding or rewording a
  criterion marks CVs for re-analysis on the next run.

Setup instructions are in **[DEMARRAGE.md](DEMARRAGE.md)** (French). The
interface inside the spreadsheet is in French; the menu follows the account
language.

License: [Elastic License 2.0](LICENSE).
