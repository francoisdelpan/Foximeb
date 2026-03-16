# Foximeb

Bot personnel Google Apps Script pour piloter la journee depuis Notion, Google Calendar, OpenAI et Discord.

## Ce que fait Foximeb

- Genere un brief quotidien a partir :
  - des taches Notion du jour et en retard
  - des evenements Google Calendar du jour
- Envoie ce brief sur Discord :
  - en embed dans le salon principal
  - en version audio via TTS
- Envoie dans un second salon Discord un bloc dedie a l'amelioration du prompt :
  - note auto-critique
  - justification courte
  - bloc unique a copier au format `INSTRUCTION / PROMPT / RESULT`
- Verifie le `Daily Tracking` dans Notion :
  - cherche la ligne du jour via la colonne `Dates`
  - controle les champs obligatoires
  - envoie une alerte dans le salon brief si la ligne est absente ou incomplete

## Structure du projet

- [Code.gs](/Users/francoisdelpan/Documents/Foximeb/Code.gs) : points d'entree Apps Script
- [brief.gs](/Users/francoisdelpan/Documents/Foximeb/brief.gs) : orchestration du brief, prompts, OpenAI, TTS
- [discord.gs](/Users/francoisdelpan/Documents/Foximeb/discord.gs) : webhooks Discord et embeds
- [notion.gs](/Users/francoisdelpan/Documents/Foximeb/notion.gs) : requetes Notion et verification du Daily Tracking
- [utils.gs](/Users/francoisdelpan/Documents/Foximeb/utils.gs) : config et helpers partages

## Variables d'environnement

A definir dans `Script Properties` de Google Apps Script.

### Obligatoires

- `OPENAI_API_KEY`
- `NOTION_API_KEY`
- `NOTION_DATABASE_ID`
- `DISCORD_WEBHOOK_URL`
- `DISCORD_IMPROVEMENT_WEBHOOK_URL`

### Daily Tracking

- `NOTION_DAILY_TRACKING_DATABASE_ID`

### Optionnelles

- `DISCORD_ALERT_WEBHOOK_URL`
  Remplace le salon brief pour certaines alertes si besoin.
- `NOTION_TASKS_TITLE_PROPERTY`
  Par defaut : `Tasks`
- `NOTION_TASKS_STATUS_PROPERTY`
  Par defaut : `States`
- `NOTION_TASKS_PRIORITY_PROPERTY`
  Par defaut : `Priority`
- `NOTION_TASKS_DUE_DATE_PROPERTY`
  Par defaut : `Due date`
- `NOTION_DAILY_TRACKING_DATE_PROPERTY`
  Par defaut : `Dates`
- `NOTION_DAILY_TRACKING_TITLE_PROPERTY`
  Par defaut : `Name`
- `NOTION_DAILY_TRACKING_REQUIRED_PROPERTIES`
  Liste separee par des virgules si tu veux surcharger les champs obligatoires.

## Champs obligatoires Daily Tracking

Par defaut, Foximeb controle :

- `Wake Up`
- `Go to bed`
- `Job`
- `Utema`
- `Digital Work`
- `Sport`
- `Ambiente`

## Fonctions principales

- `generateDailyBrief()`
  Genere le brief du matin, l'envoie sur Discord, puis envoie le bloc d'amelioration dans le second salon.
- `testBriefDiscordOutputs()`
  Meme logique, sans generer l'audio.
- `sendDailyTrackingReminderIfMissing()`
  Controle l'entree du jour dans Notion et alerte si des champs obligatoires manquent.
- `setupDailyTrackingReminderTrigger()`
  Cree un trigger Apps Script quotidien vers 22h00.

## Setup

1. Creer le projet Google Apps Script.
2. Ajouter les fichiers `.gs`.
3. Renseigner les `Script Properties`.
4. Verifier que l'integration Notion a acces aux databases utilisees.
5. Lancer une premiere fois `generateDailyBrief()`.
6. Lancer `setupDailyTrackingReminderTrigger()` pour installer le rappel du soir.

## Notes Notion

- Pour l'API Notion, utiliser l'ID brut de la database, pas l'URL complete.
- La database doit etre partagee avec l'integration Notion utilisee par Foximeb.

## Notes Discord

- Discord limite `content` a 2000 caracteres.
- Si le bloc `INSTRUCTION / PROMPT / RESULT` est trop long, Foximeb l'envoie en fichier `.txt`.

## Idee generale

Foximeb est pense comme un assistant de pilotage personnel :

- brief du matin
- hygiene d'execution
- rappel de discipline
- boucle d'amelioration continue des prompts
