# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/). Les
versions antérieures à la 1.0.0 n'étaient pas numérotées.

## [1.0.0] - 2026-09-28

Refonte de l'évaluation, après trois retours de l'équipe RH : résultats jugés
peu pertinents, toujours dix candidats « À contacter », doublons conservés.

### Ajouté

- Onglet « Grille d'évaluation » : critère, niveau (Indispensable, Important, Souhaitable), poids, précisions. « Proposer la grille depuis l'annonce » la préremplit, jamais par-dessus une grille existante.
- Évaluation critère par critère (Satisfait, Partiel, Non démontré), un extrait du CV à l'appui de chaque statut.
- Score sur 100 calculé par le code ; colonne « Détail du score » qui en montre le calcul.
- Colonne « Motif de la recommandation » : seuil atteint ou non, indispensable manquant, rang au-delà des places, doublon.
- Doublons : même email ou même téléphone, une seule fiche classée, les autres passent « Doublon ». Même nom sans coordonnée commune, ou coordonnées partagées par des noms différents : signalé « À vérifier », sans effet.
- Colonne « Décision RH », que le code n'écrit jamais et qui prime pour les brouillons d'email.
- Colonne « Brouillon créé le » : un brouillon n'est jamais refait, et un seul par adresse.
- Réglages de sélection dans le panneau : seuil de contact, seuil de vivier, nombre maximal de places.
- « Recalculer le classement », au menu et dans le panneau, sans appel à Gemini.
- Statut « À réanalyser » : un CV évalué avec une autre annonce, d'autres consignes, un autre prompt, un autre modèle, ou avant l'ajout d'un critère, est réanalysé au lancement suivant.
- Version affichée dans « À propos » et en pied du panneau.
- Banc d'essai hors Google (`node banc/test.js`), qui remplace `Test.gs`.
- `.claspignore`, `VERSION`, `LICENSE`, `DEMARRAGE.md`.

### Modifié

- « À contacter » se décide par seuils absolus, et les places sont un maximum : s'il n'y a que trois bons profils, il y a trois « À contacter ».
- Un indispensable non démontré fait refuser le CV ; démontré en partie, il plafonne au vivier.
- Les colonnes de l'onglet Résultats se retrouvent par leur en-tête. Un classeur existant reçoit les nouvelles colonnes à droite, sans rien perdre.
- Une réanalyse réécrit la ligne du CV au lieu d'en ajouter une ; un échec de réanalyse ne touche ni au nom ni à l'email.
- Une annonce donnée par URL est lue et résumée une seule fois, puis mémorisée.
- Nouveau prompt par défaut : équivalences admises si elles sont nommées, CV traité comme une donnée et non comme une consigne, critère discriminatoire neutralisé.
- « Critères spécifiques » devient « Consignes d'évaluation » ; les exigences vont dans la grille.
- La synthèse de session n'envoie plus le nom des candidats à Gemini.
- Le nettoyage RGPD pseudonymise aussi les extraits de CV, le détail du score et les mentions de doublon.
- Le panneau désigne les candidats par leur fichier et non plus par leur numéro de ligne.
- Génération des brouillons en lot : budget de temps, relance sans doublon, décompte exact de ce qui est écarté et pourquoi.
- Un Google Doc qui déclare 0 octet n'est plus rejeté comme vide (précaution).

### Corrigé

- Un candidat noté 4/5 mais mis en vivier par l'IA était promu « À contacter » : les dix places se remplissaient toujours.
- Les critères changeaient d'un CV à l'autre (« 3 compétences clés » choisies par l'IA pour chacun) : les notes ne se comparaient pas.
- À note égale, le classement dépendait de l'ordre des fichiers dans Drive.
- Le prompt par défaut, affiché dans le panneau, était figé dans les réglages au premier enregistrement : les évolutions du prompt n'atteignaient plus le classeur.
- Modifier les critères n'avait aucun effet sur les CV déjà analysés.
- Chaque analyse réécrivait la colonne « Recommandation » et écrasait les modifications faites à la main.
- Un candidat qui avait envoyé deux CV pouvait recevoir une invitation et un refus.
- Relancer la génération des emails recréait tous les brouillons.
- Un texte venu d'un CV et commençant par « = » devenait une formule dans le classeur.
- Une annonce refusée par son site (403) affichait l'exception brute au lieu du message prévu.
- Le panneau pouvait créer un brouillon pour le mauvais candidat après un tri de l'onglet.
- Une annonce collée de plus de 9 Ko échouait sur l'erreur brute de Google ; le refus dit maintenant quoi faire.
- Une erreur de lecture de la langue du compte, dans `onOpen`, aurait fait disparaître tout le menu.

### Retiré

- Cache de contexte Gemini explicite : il ne se déclenchait jamais (seuil de 130 000 caractères).
- `Test.gs` : ses cas sont repris dans le banc.
- Colonnes « Top 3 compétences » et « Note / 5 » d'un onglet neuf. Dans un classeur mis à niveau, elles restent, inutilisées.
