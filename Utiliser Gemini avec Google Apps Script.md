# 🚀 Tutoriel : Comment j'utilise l'IA Gemini dans Google Apps Script pour analyser des CV

L'analyse de dizaines (voire de centaines) de CV est une tâche chronophage. Dans mon dernier projet `gemini-cv-analyzer`, j'ai décidé d'automatiser ce processus en connectant l'intelligence artificielle de Google (Gemini) directement à Google Workspace grâce à **Google Apps Script (GAS)**.

Mais concrètement, comment fait-on parler Apps Script avec une IA de pointe ?

Si le code vous intrigue, voici une plongée pédagogique dans le moteur de mon application. Je vous explique pas à pas comment j'ai intégré Gemini dans mon script.

---

## 1. La clé du royaume : L'API Key

Pour que Google Apps Script puisse utiliser Gemini, il faut qu'il se présente. Cela se fait via une **Clé API**. C'est un mot de passe unique qui autorise mon script à utiliser les serveurs d'IA de Google.

En Apps Script, la règle d'or est de ne **jamais** écrire cette clé en clair dans le code. J'utilise donc le service des propriétés (`PropertiesService`) pour la stocker de manière sécurisée :

```javascript
// Récupération sécurisée de la clé API  
const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');  
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
```

> **💡 L'astuce pédagogique :** L'endpoint est l'adresse URL exacte à laquelle mon script va "frapper à la porte" pour déposer le CV et poser sa question.

---

## 2. Préparer le "Colis" (Le Payload)

Maintenant que l'on sait à quelle porte frapper, il faut préparer le colis que l'on va envoyer à Gemini. En informatique, ce colis s'appelle le **Payload**.

Gemini ne comprend qu'un format de données très précis et structuré appelé le **JSON**. Je dois donc emballer ma question (le *prompt*) et le texte du CV dans ce format.

Voici comment je structure ma demande :

```javascript
// Le texte extrait du CV au préalable  
const texteDuCV = "...(contenu du document)...";

// Mes instructions pour l'IA  
const prompt = `Tu es un expert en recrutement. Analyse le CV suivant et extrais les informations au format JSON avec les clés : Nom, Email, Competences, Annees_Experience. Voici le CV : \n\n ${texteDuCV}`;

// Le colis (Payload) formaté pour Gemini  
const payload = {  
  "contents": [  
    {  
      "parts": [  
        { "text": prompt }  
      ]  
    }  
  ]  
};
```

**Pourquoi lui demander de répondre en JSON ?**

C'est le secret de l'automatisation ! Si Gemini me répond avec une belle phrase littéraire, Apps Script ne saura pas la lire pour remplir un fichier Google Sheets. En lui imposant de répondre en JSON (des données structurées), mon code pourra extraire le nom et les compétences instantanément.

---

## 3. L'envoi du message : UrlFetchApp

C'est ici que la magie opère. Google Apps Script possède une fonction native surpuissante pour discuter avec le reste d'internet : `UrlFetchApp`.

C'est le postier qui va prendre notre colis, l'amener à l'adresse de Gemini, et attendre la réponse.

```javascript
// Les options d'envoi du colis  
const options = {  
  'method': 'post',                     // On "pousse" de la donnée  
  'contentType': 'application/json',    // On précise que c'est du JSON  
  'payload': JSON.stringify(payload),   // On convertit notre objet en texte JSON  
  'muteHttpExceptions': true            // Pour lire les erreurs au lieu de faire planter le script  
};

// L'envoi effectif à Gemini !  
const response = UrlFetchApp.fetch(endpoint, options);
```

---

## 4. Décoder la réponse de l'IA

Quelques secondes plus tard, Gemini nous renvoie sa réponse. Mais elle arrive brute. Il faut demander à Apps Script de l'ouvrir et de naviguer dans les "tiroirs" du JSON pour trouver l'information utile.

```javascript
// 1. On lit la réponse et on la transforme en objet lisible par le code  
const jsonResponse = JSON.parse(response.getContentText());

// 2. On navigue dans l'arborescence complexe de la réponse de Gemini  
// La structure habituelle est : candidates > content > parts > text  
const texteGenere = jsonResponse.candidates[0].content.parts[0].text;

// 3. On nettoie si besoin (Gemini rajoute parfois des balises \`\`\`json au début et à la fin)  
const textePropre = texteGenere.replace(/```json/g, "").replace(/```/g, "");

// 4. On re-transforme la réponse en objet manipulable !  
const donneesCandidat = JSON.parse(textePropre);

// Résultat : Je peux maintenant faire donneesCandidat.Nom ou donneesCandidat.Email !
```

---

## 5. Focus : Le traitement des Compétences (Skills)

Un CV contient souvent des dizaines de compétences éparpillées. L'un des plus grands intérêts d'utiliser l'IA ici, c'est de lui demander de synthétiser ces compétences.

Grâce à notre prompt en JSON, Gemini va comprendre qu'il doit regrouper les compétences dans une liste (ce qu'on appelle un tableau, ou *Array*, en JavaScript).

Voici à quoi ressemble la donnée brute renvoyée par Gemini pour les compétences :

```json
["JavaScript", "Google Apps Script", "Gestion de projet", "IA"]
```

Pour que cela s'affiche proprement dans **une seule et même cellule** de notre Google Sheets, j'utilise une fonction native de JavaScript très pratique : `join()`.

```javascript
// On vérifie que Gemini a bien trouvé des compétences  
if (donneesCandidat.Competences && donneesCandidat.Competences.length > 0) {  
    
  // On transforme la liste en un seul texte, séparé par une virgule et un espace  
  const listeCompetencesFormatee = donneesCandidat.Competences.join(", ");  
    
  // Résultat prêt pour Google Sheets : "JavaScript, Google Apps Script, Gestion de projet, IA"  
    
} else {  
  const listeCompetencesFormatee = "Non précisé";  
}
```

L'IA a fait le travail de lecture et de tri, et notre petit bout de code se charge de la mise en page parfaite pour le tableur !

---

## En résumé

Intégrer Gemini dans Google Apps Script se résume à 5 grandes étapes :

1. Sécuriser son **API Key**.  
2. Formater son **Prompt** de manière stricte (idéalement en imposant une sortie JSON).  
3. Utiliser **UrlFetchApp** pour dialoguer avec les serveurs de Google.  
4. **Parser (décoder)** la réponse de l'IA.  
5. **Formater les données complexes** (comme les listes de compétences) pour les adapter à Sheets ou Docs.

Le projet `gemini-cv-analyzer` repose entièrement sur cette mécanique. Une fois les données extraites proprement, il ne reste plus qu'à utiliser les fonctions natives d'Apps Script pour écrire tout cela dans la prochaine ligne vide d'un fichier Google Sheets.

Et voilà comment on passe d'une pile de PDF indéchiffrables à un tableau de bord de recrutement propre et structuré en quelques lignes de code !

> *Vous souhaitez voir le code complet et l'installer sur votre espace Workspace ? Retrouvez le sur mon [dépôt GitHub](https://github.com/FabriceFx/gemini-cv-analyzer) ; vous voulez de l'aide pour vos cas d'usage, contactez moi depuis mon site [faucheux.bzh](https://faucheux.bzh) !*