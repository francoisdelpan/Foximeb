function generateDailyBrief() {
  var props = PropertiesService.getScriptProperties();
  var notionKey = props.getProperty('NOTION_API_KEY');
  var notionDbId = props.getProperty('NOTION_DATABASE_ID');
  var openaiKey = props.getProperty('OPENAI_API_KEY');
  var discordWebhook = props.getProperty('DISCORD_WEBHOOK_URL');

  // 1. Tâches Notion
  var pack = getNotionTasksTodayAndOverdue(notionKey, notionDbId);
  var tasksToday = pack.today;
  var tasksOverdue = pack.overdue;

  // 2. Événements Google Calendar
  var events = getEventsForToday();

  // 3. Générer le brief via OpenAI
  var briefText = generateBriefWithOpenAI(openaiKey, tasksToday, tasksOverdue, events);;

  // 4. Transformer en MP3 avec TTS
  var audioBlob = textToSpeechMp3(openaiKey, briefText);

  // 5. Envoyer sur Discord
  postBriefToDiscord(discordWebhook, briefText);

  // 6. Envoyer le MP3 sur Discord
  sendAudioToDiscord(discordWebhook, audioBlob, "🎧 **Brief vocal** 🎧");
}

/**
 * Utils
 */
function isoDateParis(d) {
  return Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd');
}

function daysBetweenParis(dateStr, todayStr) {
  // dateStr, todayStr in YYYY-MM-DD
  var d1 = new Date(dateStr + 'T00:00:00');
  var d2 = new Date(todayStr + 'T00:00:00');
  var ms = d2.getTime() - d1.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Récupère les tâches Notion du jour et passées.
 * Adapte les noms de propriétés : "Date", "Name", "Status", etc.
 */
function getNotionTasksTodayAndOverdue(notionKey, notionDbId) {
  var today = new Date();
  var isoToday = isoDateParis(today); // YYYY-MM-DD in Europe/Paris

  var url = 'https://api.notion.com/v1/databases/' + notionDbId + '/query';

  // ⚠️ Ajuste les noms si ton "Done" n’est pas exactement "Done"
  var payload = {
    filter: {
      and: [
        {
          property: 'Due date',
          date: { on_or_before: isoToday }
        },
        {
          or: [
            {
              property: 'States',
              status: { equals: 'Not started' }
            },
            {
              property: 'States',
              status: { equals: 'In progress' }
            },
            {
              property: 'States',
              status: { equals: 'Testing' }
            }
          ]
        }
      ]
    },
    // Optionnel : trier par date croissante puis priorité
    sorts: [
      { property: 'Due date', direction: 'ascending' }
    ],
    page_size: 100
  };

  var options = {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + notionKey,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());

  if (data.object === 'error') {
    Logger.log('NOTION ERROR: ' + data.message);
    return { today: [], overdue: [] };
  }

  var todayList = [];
  var overdueList = [];

  (data.results || []).forEach(function(page) {
    var props = page.properties;

    var titleProp    = props['Tasks'];     // title
    var statusProp   = props['States'];    // status
    var priorityProp = props['Priority'];  // select
    var dueProp      = props['Due date'];  // date

    var title = '';
    if (titleProp && titleProp.title && titleProp.title.length > 0) {
      title = titleProp.title.map(function(t) { return t.plain_text; }).join('');
    }
    if (!title) return;

    var status = statusProp && statusProp.status ? statusProp.status.name : '';

    var priority = '';
    if (priorityProp && priorityProp.select) {
      priority = priorityProp.select.name; // P1 / P2 / ...
    }

    var due = null;
    if (dueProp && dueProp.date && dueProp.date.start) {
      due = dueProp.date.start; // YYYY-MM-DD
    }
    if (!due) return; // si pas de date, on ignore (ou tu peux faire un bucket "undated")

    var ageDays = daysBetweenParis(due, isoToday); // 0=today, 1=yesterday, 2+=older

    var taskObj = {
      title: title,
      status: status,
      priority: priority,
      due: due,
      age_days: ageDays
    };

    if (ageDays === 0) {
      todayList.push(taskObj);
    } else if (ageDays >= 1) {
      overdueList.push(taskObj);
    }
  });

  // Tri : today -> P1 avant P2 ; overdue -> d'abord yesterday puis vieux, et P1 avant P2
  function prioRank(p) {
    if (p === 'P1') return 1;
    if (p === 'P2') return 2;
    if (p === 'P3') return 3;
    return 9;
  }

  todayList.sort(function(a, b) {
    return prioRank(a.priority) - prioRank(b.priority);
  });

  overdueList.sort(function(a, b) {
    // J-1 d'abord (age_days 1), ensuite plus vieux ; et à âge égal, P1 avant
    if (a.age_days !== b.age_days) return a.age_days - b.age_days;
    return prioRank(a.priority) - prioRank(b.priority);
  });

  //console.log(todayList);
  //console.log(overdueList);

  return { today: todayList, overdue: overdueList };
}

/**
 * Récupère les events du jour sur ton calendrier par défaut.
 */
function getEventsForToday() {
  var calendar = CalendarApp.getDefaultCalendar();
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

  var events = calendar.getEvents(start, end);
  var list = [];

  events.forEach(function(ev) {
    list.push({
      title: ev.getTitle(),
      start: ev.getStartTime()
    });
  });

  //Logger.log(list);
  return list;
}

/**
 * Appelle OpenAI pour générer un brief lisible à voix haute.
 */
function generateBriefWithOpenAI(openaiKey, tasksToday, tasksOverdue, events) {
  function fmtTask(t) {
    var s = '- ' + t.title;
    if (t.priority) s += ' [' + t.priority + ']';
    if (t.status) s += ' (' + t.status + ')';
    if (t.due) s += ' — échéance ' + t.due;
    if (typeof t.age_days === 'number' && t.age_days > 0) s += ' — retard J-' + t.age_days;
    return s;
  }

  var todayText = tasksToday.length
    ? tasksToday.map(fmtTask).join('\n')
    : 'Aucune tâche datée d’aujourd’hui.';

  var overdueText = tasksOverdue.length
    ? tasksOverdue.map(fmtTask).join('\n')
    : 'Aucune tâche en retard.';

  var eventsText = events.length
    ? events.map(function(e) {
        return '- ' + Utilities.formatDate(e.start, 'Europe/Paris', 'HH:mm') + ' : ' + e.title;
      }).join('\n')
    : 'Aucun évènement prévu.';

  var systemPrompt =
    "Tu es Foximeb, assistant de pilotage opérationnel. " +
    "Tu produis un brief orienté exécution, direct et factuel tel un assistant de grand chef d'entreprise ou politique de haut rang. " +
    "Tu t’adresses à François au tutoiement. " +
    "Zéro morale, zéro psychologie, zéro blabla. " +
    "Le brief est destiné à être écouté à voix haute : phrases courtes, claires, rythmiques. " +
    "Objectif : donner un ordre d’attaque concret pour la journée.";

  var userPrompt =
    "Voici les données du jour.\n\n" +
    "ÉVÈNEMENTS :\n" + eventsText + "\n\n" +
    "TÂCHES AUJOURD’HUI :\n" + todayText + "\n\n" +
    "RETARD :\n" + overdueText + "\n\n" +
    "Règles de décision :\n" +
    "1) Les tâches en retard J-1 doivent être traitées comme des tâches d’aujourd’hui (oubli de replanification).\n" +
    "2) Plus une tâche est ancienne (J-2, J-3, etc.), moins elle est importante a priori.\n" +
    "3) Priorité : P1 avant P2. Mais si une P1 est ancienne, signale-la et impose une décision : la faire aujourd’hui OU la replanifier explicitement.\n" +
    "4) Donne un plan d’attaque : 1er bloc de travail, 2e bloc, et ce qui peut attendre.\n" +
    "5) Limite les priorités du jour à 3 maximum (sinon tu choisis).\n" +
    "6) Mentionne les évènements seulement s’ils contraignent l’exécution.\n" +
    "7) Ne recopie pas les listes telles quelles : synthétise et tranche.\n\n" +
    "Écris uniquement le brief final.";

  var url = 'https://api.openai.com/v1/chat/completions';
  var payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.4,
    max_tokens: 450
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + openaiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());

  if (!data.choices || !data.choices.length) {
    throw new Error('Réponse OpenAI invalide : ' + response.getContentText());
  }

  return data.choices[0].message.content.trim();
}

function textToSpeechMp3(openaiKey, text) {
  var url = "https://api.openai.com/v1/audio/speech";

  var payload = {
    model: "gpt-4o-mini-tts",
    voice: "coral",          // tu peux tester d’autres voix plus tard
    input: text,
    response_format: "mp3",  // par défaut mp3, mais on précise
    speed: 1.2
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Bearer " + openaiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log("OPENAI TTS ERROR: " + code + " - " + response.getContentText());
    throw new Error("OpenAI TTS error: " + code);
  }

  var blob = response.getBlob();
  var now = new Date();
  var name = "brief_" + Utilities.formatDate(now, "Europe/Paris", "yyyyMMdd_HHmm") + ".mp3";
  blob.setName(name);
  return blob;
}

/**
 * Envoie le brief sur Discord via un webhook.
 */
function postBriefToDiscord(discordWebhook, briefText) {
  var payload = {
    content: '📄 **Brief du jour** 📄\n\n' + briefText
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(discordWebhook, options);
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Erreur Discord : ' + code + ' - ' + response.getContentText());
  }
}

function sendAudioToDiscord(discordWebhook, audioBlob, caption) {
  var payload = {
    file: audioBlob,
    content: caption || "🎧 Brief vocal du jour"
  };

  var options = {
    method: "post",
    payload: payload,      // NE PAS mettre contentType → Apps Script gère le multipart/form-data
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(discordWebhook, options);
  var code = response.getResponseCode();
  Logger.log("DISCORD RESPONSE CODE: " + code + " - " + response.getContentText());
  if (code < 200 || code >= 300) {
    throw new Error("Erreur Discord : " + code);
  }
}