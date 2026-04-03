# Foximeb

Bot personnel Google Apps Script pour piloter la journee depuis Todoist, Google Drive, Google Calendar, OpenAI et Discord.

## Ce que fait Foximeb

- Genere un brief quotidien a partir :
  - des taches Todoist du jour et en retard
  - des evenements Google Calendar du jour
  - des horaires de travail d un agenda dedie si configure
- Envoie ce brief sur Discord :
  - en embed dans le salon principal
  - en version audio via TTS
- Envoie dans un second salon Discord un bloc dedie a l'amelioration du prompt :
  - note auto-critique
  - justification courte
  - bloc unique a copier au format `INSTRUCTION / PROMPT / RESULT`
- Verifie le `Daily Tracking` du soir depuis Google Drive :
  - cherche un fichier Daily Tracking exploitable dans un dossier Drive configure
  - detecte l entree du jour dans le fichier
  - controle les champs obligatoires
  - envoie une alerte Discord en embed, generee via OpenAI avec fallback local

## Structure du projet

- [Code.gs](/Users/francoisdelpan/Documents/Foximeb/Code.gs) : points d'entree Apps Script
- [brief.gs](/Users/francoisdelpan/Documents/Foximeb/brief.gs) : brief quotidien, prompts, OpenAI, TTS
- [calendar.gs](/Users/francoisdelpan/Documents/Foximeb/calendar.gs) : lecture et agregation des agendas Google Calendar
- [weekly_planning.gs](/Users/francoisdelpan/Documents/Foximeb/weekly_planning.gs) : logique et rendu du plan hebdomadaire
- [discord.gs](/Users/francoisdelpan/Documents/Foximeb/discord.gs) : webhooks Discord et embeds
- [todoist.gs](/Users/francoisdelpan/Documents/Foximeb/todoist.gs) : lecture Todoist et compatibilite de migration pour les taches du brief
- [daily_tracking_drive.gs](/Users/francoisdelpan/Documents/Foximeb/daily_tracking_drive.gs) : lecture Drive, parsing du fichier `DAILY-TRACKING.base`, application des regles du soir
- [utils.gs](/Users/francoisdelpan/Documents/Foximeb/utils.gs) : config et helpers partages

## Variables d'environnement

A definir dans `Script Properties` de Google Apps Script.

### Obligatoires

- `OPENAI_API_KEY`
- `TODOIST_API_TOKEN`
- `DISCORD_WEBHOOK_URL`
- `DISCORD_IMPROVEMENT_WEBHOOK_URL`

### Daily Tracking du soir

- `GOOGLE_DAILY_TRACKING_FOLDER_ID`
  ID du dossier Google Drive qui contient les fichiers Daily Tracking. Tu peux aussi coller l URL complete du dossier: le script sait en extraire l identifiant.

### Optionnelles

- `DISCORD_ALERT_WEBHOOK_URL`
  Webhook cible pour les alertes, dont la notif du soir Daily Tracking. Par defaut, Foximeb reutilise `DISCORD_WEBHOOK_URL`.
- `DISCORD_WEEKLY_PLANNING_WEBHOOK_URL`
  Webhook du salon cible pour le recap hebdo. Par defaut, Foximeb reutilise `DISCORD_WEBHOOK_URL`.
- `WORK_CALENDAR_ID`
  ID de l agenda Google Calendar dedie au travail. Si defini, Foximeb l injecte dans le brief comme contrainte dure.
- `DAILY_TRACKING_REQUIRED_PROPERTIES`
  Liste separee par des virgules si tu veux surcharger les champs obligatoires controles dans le fichier texte.

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
- `testTodoistTasksForToday()`
  Verifie la lecture Todoist, la pagination et la repartition `today / overdue` sans passer par Discord.
- `generateWeeklyPlan()`
  Genere la proposition de slots de la semaine a venir et l envoie sur Discord.
- `testWeeklyPlan()`
  Lance la generation du plan hebdo a la demande.
- `sendDailyTrackingReminderIfMissing()`
  Controle l entree du jour dans `DAILY-TRACKING.base`, applique les regles, puis envoie une alerte Discord si besoin.
- `testDailyTrackingReminderFromDrive()`
  Lance le meme workflow du soir a la demande pour valider parsing, regles et embed.
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
- La creation automatique de taches Todoist n est pas encore branchee.

## Setup

1. Creer le projet Google Apps Script.
2. Ajouter les fichiers `.gs`.
3. Renseigner les `Script Properties`.
4. Ajouter `TODOIST_API_TOKEN` dans les `Script Properties`.
5. Lancer `testTodoistTasksForToday()` pour verifier la connexion Todoist.
6. Lancer une premiere fois `generateDailyBrief()`.
7. Ajouter `GOOGLE_DAILY_TRACKING_FOLDER_ID` dans les `Script Properties`.
8. Lancer `setupDailyTrackingReminderTrigger()` pour installer le rappel du soir.

## Notes Daily Tracking du soir

- Le script explore le dossier Drive cible via `GOOGLE_DAILY_TRACKING_FOLDER_ID`.
- Il priorise les fichiers dont le nom contient la date du jour, puis les fichiers les plus recents.
- Il prend en charge les fichiers Markdown, `.base` et Google Docs.
- Il detecte les entrees via une date presente dans une ligne, au format `yyyy-MM-dd` ou `dd/MM/yyyy`.
- A l interieur d une entree, les champs sont lus au format `Cle: valeur`, `Cle = valeur`, `Cle - valeur` ou checklist markdown.
- Si aucune entree du jour n est trouvee, Foximeb prend la plus recente pour expliquer ce qui manque dans l embed.

## Notes Discord

- Discord limite `content` a 2000 caracteres.
- Si le bloc `INSTRUCTION / PROMPT / RESULT` est trop long, Foximeb l'envoie en fichier `.txt`.

## Idee generale

Foximeb est pense comme un assistant de pilotage personnel :

- brief du matin
- hygiene d'execution
- rappel de discipline
- boucle d'amelioration continue des prompts
