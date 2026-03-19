# Foximeb

Bot personnel Google Apps Script pour piloter la journee depuis Notion, Google Calendar, OpenAI et Discord.

## Ce que fait Foximeb

- Genere un brief quotidien a partir :
  - des taches Notion du jour et en retard
  - des evenements Google Calendar du jour
  - des horaires de travail d un agenda dedie si configure
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
- `DISCORD_WEEKLY_PLANNING_WEBHOOK_URL`
  Webhook du salon cible pour le recap hebdo. Par defaut, Foximeb reutilise `DISCORD_WEBHOOK_URL`.
- `WORK_CALENDAR_ID`
  ID de l agenda Google Calendar dedie au travail. Si defini, Foximeb l injecte dans le brief comme contrainte dure.
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
- `generateWeeklyPlan()`
  Genere la proposition de slots de la semaine a venir et l envoie sur Discord.
- `testWeeklyPlan()`
  Lance la generation du plan hebdo a la demande.
- `sendDailyTrackingReminderIfMissing()`
  Controle l'entree du jour dans Notion et alerte si des champs obligatoires manquent.
- `setupDailyTrackingReminderTrigger()`
  Cree un trigger Apps Script quotidien vers 22h00.
- `setupWeeklyPlanningTrigger()`
  Cree un trigger Apps Script hebdomadaire le dimanche matin vers 09h00.

## Agenda de travail

- L agenda principal continue de fournir les evenements generaux de la journee.
- Si `WORK_CALENDAR_ID` est renseigne, `getWorkSchedule(...)` lit cet agenda separement.
- Le prompt du brief utilise ensuite ces horaires comme contrainte dure pour organiser le plan d attaque.
- Si plusieurs blocs existent dans la meme journee, Foximeb calcule aussi la coupure totale pour mieux formuler le brief.

## Planification hebdomadaire

- `generateWeeklyPlan()` lit la semaine de travail a venir a partir de `WORK_CALENDAR_ID`.
- Le prompt integre les contraintes sport, deepwork Utema, menage du samedi, rando et fin des ecrans.
- Le resultat est envoye dans Discord sous forme de recap court en embed.
- La creation automatique de taches Notion n est pas encore branchee.

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
