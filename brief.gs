function runDailyBriefWorkflow(options) {
  var workflowOptions = options || {};
  var config = getScriptConfig();

  requireConfig(config, [
    'notionApiKey',
    'notionTasksDatabaseId',
    'openaiApiKey',
    'discordBriefWebhookUrl',
    'discordPromptWebhookUrl'
  ]);

  var context = collectDailyBriefContext(config);
  var prompts = buildDailyBriefPrompts(context);
  var briefText = generateBriefWithOpenAI(config.openaiApiKey, prompts);
  var selfReview = generateBriefSelfReview(config.openaiApiKey, prompts, briefText);
  var improvementPack = buildImprovementPack(prompts, briefText, selfReview);
  var audioBlob = workflowOptions.skipTts ? null : textToSpeechMp3(config.openaiApiKey, briefText);
  var briefPackage = {
    context: context,
    prompts: prompts,
    briefText: briefText,
    selfReview: selfReview,
    improvementPack: improvementPack
  };

  sendBriefToDiscordChannels(config, briefPackage, audioBlob);

  return briefPackage;
}

function runDailyTrackingReminderWorkflow() {
  var config = getScriptConfig();
  var trackingStatus;

  requireConfig(config, [
    'notionApiKey',
    'notionDailyTrackingDatabaseId',
    'discordBriefWebhookUrl'
  ]);

  trackingStatus = getDailyTrackingStatus(config, new Date());

  if (trackingStatus.completed) {
    Logger.log('Daily Tracking deja rempli pour ' + trackingStatus.date);
    return trackingStatus;
  }

  sendDailyTrackingAlert(config, trackingStatus);
  return trackingStatus;
}

function collectDailyBriefContext(config) {
  var taskPack = getNotionTasksTodayAndOverdue(config);

  return {
    tasksToday: taskPack.today,
    tasksOverdue: taskPack.overdue,
    events: getEventsForToday()
  };
}

function getEventsForToday() {
  var calendar = CalendarApp.getDefaultCalendar();
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

  return calendar.getEvents(start, end).map(function(event) {
    return {
      title: event.getTitle(),
      start: event.getStartTime()
    };
  });
}

function buildDailyBriefPrompts(context) {
  var systemPrompt =
    'Tu es Foximeb, assistant de pilotage operationnel. ' +
    'Tu produis un brief oriente execution, direct et factuel, au niveau d exigence d un bras droit de dirigeant. ' +
    'Tu t adresses a Francois au tutoiement. ' +
    'Zero morale, zero psychologie, zero blabla. ' +
    'Le brief est destine a etre lu et ecoute a voix haute: phrases courtes, claires, rythmiques. ' +
    'Objectif: donner un ordre d attaque concret pour la journee.';

  var userPrompt =
    'Voici les donnees du jour.\n\n' +
    'EVENEMENTS:\n' + formatEventsForPrompt(context.events) + '\n\n' +
    'TACHES AUJOURD HUI:\n' + formatTasksForPrompt(context.tasksToday) + '\n\n' +
    'RETARD:\n' + formatTasksForPrompt(context.tasksOverdue) + '\n\n' +
    'Regles de decision:\n' +
    '1. Les taches en retard J-1 doivent etre traitees comme des taches d aujourd hui.\n' +
    '2. Plus une tache est ancienne, moins elle est importante a priori.\n' +
    '3. Priorite P1 avant P2. Si une P1 est ancienne, impose une decision explicite: la faire aujourd hui ou la replanifier.\n' +
    '4. Donne un plan d attaque: premier bloc, deuxieme bloc, et ce qui peut attendre.\n' +
    '5. Limite les priorites du jour a 3 maximum.\n' +
    '6. Mentionne les evenements seulement s ils contraignent l execution.\n' +
    '7. Ne recopie pas les listes telles quelles: synthetise et tranche.\n\n' +
    'Ecris uniquement le brief final.';

  return {
    systemPrompt: systemPrompt,
    userPrompt: userPrompt
  };
}

function formatTasksForPrompt(tasks) {
  if (!tasks.length) {
    return 'Aucune tache.';
  }

  return tasks.map(function(task) {
    var line = '- ' + task.title;

    if (task.priority) {
      line += ' [' + task.priority + ']';
    }

    if (task.status) {
      line += ' (' + task.status + ')';
    }

    if (task.due) {
      line += ' - echeance ' + task.due;
    }

    if (typeof task.age_days === 'number' && task.age_days > 0) {
      line += ' - retard J-' + task.age_days;
    }

    return line;
  }).join('\n');
}

function formatEventsForPrompt(events) {
  if (!events.length) {
    return 'Aucun evenement prevu.';
  }

  return events.map(function(event) {
    return '- ' + formatParis(event.start, 'HH:mm') + ' : ' + event.title;
  }).join('\n');
}

function generateBriefWithOpenAI(openaiApiKey, prompts) {
  var data = callOpenAIChat(openaiApiKey, {
    model: 'gpt-4o-mini',
    temperature: 0.4,
    max_tokens: 450,
    messages: [
      { role: 'system', content: prompts.systemPrompt },
      { role: 'user', content: prompts.userPrompt }
    ]
  });

  return extractOpenAIText(data);
}

function generateBriefSelfReview(openaiApiKey, prompts, briefText) {
  var reviewPrompt =
    'Tu es le relecteur le plus exigeant possible du brief ci-dessous.\n' +
    'Donne une critique honnete, froide et utile.\n' +
    'Format strict:\n' +
    'NOTE: x/10\n' +
    'JUSTIFICATION: 1 ou 2 phrases maximum\n\n' +
    'SYSTEM PROMPT:\n' + prompts.systemPrompt + '\n\n' +
    'USER PROMPT:\n' + prompts.userPrompt + '\n\n' +
    'BRIEF:\n' + briefText;

  var data = callOpenAIChat(openaiApiKey, {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 350,
    messages: [
      {
        role: 'system',
        content: 'Tu es un directeur de cabinet brutalement honnete. Ta mission est d augmenter la qualite du brief, pas de flatter.'
      },
      { role: 'user', content: reviewPrompt }
    ]
  });
  var fullText = extractOpenAIText(data);

  return {
    fullText: fullText,
    scoreLine: extractLabelValue(fullText, 'NOTE') || 'Note non extraite',
    justification: extractLabelValue(fullText, 'JUSTIFICATION') || fullText
  };
}

function buildImprovementPack(prompts, briefText, selfReview) {
  return {
    instructions:
      'Ameliore le prompt de generation de ce brief quotidien sans changer l intention du brief. Sois concret, plus dense, plus direct, et reduis les banalites.',
    prompt: prompts.systemPrompt + '\n\n' + prompts.userPrompt,
    result: briefText
  };
}

function callOpenAIChat(openaiApiKey, payload) {
  return fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + openaiApiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function extractOpenAIText(data) {
  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('Reponse OpenAI invalide: ' + JSON.stringify(data));
  }

  return String(data.choices[0].message.content || '').trim();
}

function extractLabelValue(text, label) {
  var regex = new RegExp(label + '\\s*:\\s*([\\s\\S]*?)(?:\\n[A-Z_]+\\s*:|$)');
  var match = text.match(regex);

  return match ? match[1].trim() : '';
}

function textToSpeechMp3(openaiApiKey, text) {
  var response = UrlFetchApp.fetch('https://api.openai.com/v1/audio/speech', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + openaiApiKey
    },
    payload: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      input: text,
      response_format: 'mp3',
      speed: 1.2
    }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var blob;

  if (code < 200 || code >= 300) {
    throw new Error('OpenAI TTS error: ' + code + ' - ' + response.getContentText());
  }

  blob = response.getBlob();
  blob.setName('brief_' + formatParis(new Date(), 'yyyyMMdd_HHmm') + '.mp3');
  return blob;
}
