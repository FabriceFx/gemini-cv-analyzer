# 🚀 Tutoriel : Comment j'utilise l'IA Gemini dans Google Apps Script pour analyser des CV

L'analyse de dizaines (voire de centaines) de CV est une tâche chronophage. Dans mon dernier projet `gemini-cv-analyzer`, j'ai décidé d'automatiser ce processus en connectant l'intelligence artificielle de Google (Gemini) directement à Google Workspace grâce à **Google Apps Script (GAS)**.

Si le code vous intrigue, voici une plongée pédagogique dans le moteur de mon application pour vous expliquer comment utiliser la **Structured Output** (Sortie structurée) avec Gemini.

---

## 1. La clé du royaume : L'API Key

Pour que Google Apps Script puisse utiliser Gemini, il faut qu'il se présente. Cela se fait via une **Clé API**. C'est un mot de passe unique qui autorise mon script à utiliser les serveurs d'IA de Google.

En Apps Script, on ne stocke **jamais** cette clé en clair dans le code. On utilise le service des propriétés (`PropertiesService`) :

```javascript
// Récupération sécurisée de la clé API  
const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');  
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
```

> **💡 L'astuce pédagogique :** L'endpoint utilise ici le modèle de dernière génération `gemini-3.5-flash`, extrêmement rapide et économique pour l'analyse de documents volumineux.

---

## 2. Préparer le "Colis" et forcer la Sortie Structurée (JSON Schema)

Il faut préparer le colis (**Payload**) que l'on va envoyer à Gemini. 
Pour être certain que Gemini réponde exactement avec le format de données attendu (sans ajouter de texte littéraire ou de balises "```json"), on utilise une fonctionnalité très puissante de l'API : **le paramètre `responseSchema`**.

On commence par définir notre schéma, c'est-à-dire le "moule" dans lequel Gemini devra couler sa réponse :

```javascript
const responseSchema = {
  type: "OBJECT",
  properties: {
    candidateName: { type: "STRING", description: "Nom et Prénom du candidat." },
    email: { type: "STRING", description: "Adresse email." },
    skills: { type: "STRING", description: "Compétences clés du candidat." },
    score: { type: "INTEGER", description: "Note d'adéquation sur 5." }
  },
  required: ["candidateName", "email", "skills", "score"]
};
```

Puis, on intègre ce schéma dans notre payload, avec le fameux CV (converti en Base64 via `Utilities.base64Encode`) :

```javascript
const prompt = "Analyse ce CV par rapport à nos critères...";

const payload = {
  contents: [{
    role: "user",
    parts: [
      { text: prompt },
      {
        inlineData: {
          mimeType: "application/pdf",
          data: pdfEnBase64
        }
      }
    ]
  }],
  generationConfig: {
    responseMimeType: "application/json", // On impose le JSON
    responseSchema: responseSchema,       // On impose NOTRE format JSON
    temperature: 0.1
  }
};
```

**Pourquoi imposer un schéma JSON ?**
C'est le secret de l'automatisation robuste ! Mon code Apps Script n'aura pas à deviner comment analyser un texte généré aléatoirement. La réponse sera un objet JSON prévisible et standardisé, idéal pour peupler les cellules d'un tableur.

---

## 3. L'envoi du message : UrlFetchApp

Google Apps Script possède une fonction native pour discuter avec les API : `UrlFetchApp`. C'est le postier qui amène notre colis.

```javascript
const options = {  
  method: 'post',                     
  contentType: 'application/json',    
  payload: JSON.stringify(payload),   
  muteHttpExceptions: true            
};

// L'envoi effectif à Gemini !  
const response = UrlFetchApp.fetch(endpoint, options);
```

---

## 4. Décoder la réponse de l'IA

La réponse revient instantanément formatée selon notre `responseSchema` (plus besoin de découper des balises à la main).

```javascript
// 1. On lit la réponse brute 
const jsonResponse = JSON.parse(response.getContentText());

// 2. On récupère le texte exact renvoyé par le modèle
const texteGenere = jsonResponse.candidates[0].content.parts[0].text;

// 3. On le transforme directement en objet manipulable !  
const donneesCandidat = JSON.parse(texteGenere);

// Résultat : Je peux utiliser donneesCandidat.candidateName ou donneesCandidat.score !
```

Le projet complet `gemini-cv-analyzer` pousse ces concepts encore plus loin (Context Caching, génération de brouillons d'emails automatisée, et purges RGPD optimisées).

> *Vous souhaitez voir le code complet et l'installer sur votre espace Workspace ? Retrouvez le sur mon [dépôt GitHub](https://github.com/FabriceFx/gemini-cv-analyzer).*