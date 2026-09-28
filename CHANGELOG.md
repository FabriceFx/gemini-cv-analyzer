# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/). Les
versions antérieures à la 1.0.0 n'étaient pas numérotées.

## [1.0.3] - 2026-09-28

### Corrigé

- La version 1.0.2 s'affichait « 1.0.1 » dans « À propos » et en pied du panneau : la constante du code n'avait pas suivi le fichier `VERSION`.
- Le nom de l'outil s'écrivait trois fois dans le panneau : barre de titre de Google, en-tête et pied de page. Il ne reste que la barre de titre (« 🚀 Analyseur de CV », sans le « AI » anglais) ; l'en-tête n'affiche plus que l'état de l'analyse, le pied de page la version.
- Sur l'onglet Suivi, la fin d'analyse était dite deux fois (bandeau et libellé de progression) : le bandeau ne s'affiche plus que sur les autres onglets.
- Sur la fiche d'un doublon, le motif et la section « Doublon » disaient la même chose ; la section ne se montre plus que pour ce qu'elle seule apprend. Le motif perd sa double parenthèse.

## [1.0.2] - 2026-09-28

Corrections issues du premier essai en production.

### Ajouté

- Liste des modèles lue chez Google (`models.list`), filtrée sur les modèles de texte et gardée six heures en cache ; la liste écrite dans le code ne sert plus que de secours, et le panneau dit laquelle il affiche.
- Un classeur neuf reçoit le modèle « flash » stable le plus récent de Google. Un modèle déjà enregistré n'est jamais remplacé : s'il a disparu, le panneau le signale.

### Modifié

- Un critère indispensable que le CV ne démontre pas ne fait plus refuser : le CV plafonne au vivier, avec « à vérifier avant tout contact » dans le motif. Un CV muet sur un point n'est pas un candidat qui en manque. Le refus ne vient plus que du score, sous le seuil de vivier.
- « Proposer la grille » fonctionne aussi sur une grille déjà remplie : après confirmation, qui dit que les retouches de l'équipe seront perdues et les CV réanalysés, la proposition remplace la grille. Auparavant, il fallait vider l'onglet à la main.
- Mise à niveau d'un classeur de la version non numérotée : les colonnes « Note / 5 » et « Top 3 compétences » sont supprimées.
- Le panneau dit depuis quand l'analyse attend son démarrage ; au-delà de 3 minutes, il explique ce qui peut le retarder et où regarder, et continue de suivre au lieu d'afficher une erreur.

### Corrigé

- Une ligne réanalysée affichait l'ancienne note sur 5 à côté du nouveau score sur 100 (« 4/5 » et « 42/100 » pour le même CV).
- Un profil solide qui ne mentionnait pas un critère indispensable (le niveau d'anglais) était refusé.
- Un démarrage programmé qui trouvait l'outil occupé (recalcul, brouillons, proposition de grille) repartait sans rien dire : l'état restait « Programmé ». Il réessaie désormais chaque minute, et renonce en le disant au-delà d'un quart d'heure.
- Un modèle retiré par Google mettait chaque CV en erreur (HTTP 404) ; l'analyse s'arrête désormais au premier lot, avec un message qui dit de choisir un autre modèle.
- Un chien de garde impossible à poser laissait l'état « Programmé » ; l'échec est maintenant signalé.
- Dans le panneau, plus aucun message ne s'affichait après le premier, erreurs comprises : « Proposer » semblait ne rien faire quand la grille existait déjà. L'erreur s'affiche aussi dans la carte de la grille.
- Le nettoyage RGPD ne prenait pas le verrou : un tri simultané pouvait lui faire pseudonymiser la ligne d'un autre candidat.

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
