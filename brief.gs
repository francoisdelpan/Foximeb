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
  var workSchedule = getWorkSchedule(config, new Date());
  var workSummary = summarizeWorkSchedule(workSchedule);

  return {
    tasksToday: taskPack.today,
    tasksOverdue: taskPack.overdue,
    events: getEventsForToday(),
    workSchedule: workSchedule,
    workSummary: workSummary,
    workHeadline: buildWorkHeadline(workSummary)
  };
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
    'OUVERTURE OBLIGATOIRE DU BRIEF:\n' + context.workHeadline + '\n\n' +
    'EVENEMENTS:\n' + formatEventsForPrompt(context.events) + '\n\n' +
    'HORAIRES DE TRAVAIL:\n' + formatWorkScheduleForPrompt(context.workSchedule, context.workSummary) + '\n\n' +
    'TACHES AUJOURD HUI:\n' + formatTasksForPrompt(context.tasksToday) + '\n\n' +
    'RETARD:\n' + formatTasksForPrompt(context.tasksOverdue) + '\n\n' +
    'Regles de decision:\n' +
    '1. Les taches en retard J-1 doivent etre traitees comme des taches d aujourd hui.\n' +
    '2. Plus une tache est ancienne, moins elle est importante a priori.\n' +
    '3. Priorite P1 avant P2. Si une P1 est ancienne, impose une decision explicite: la faire aujourd hui ou la replanifier.\n' +
    '4. Donne un plan d attaque sans inventer des horaires de blocs precis pour les taches. Parle en sequences et priorites, pas en heures.\n' +
    '5. Limite les priorites du jour a 3 maximum.\n' +
    '6. Les horaires de travail sont une contrainte dure: le plan d attaque doit tenir autour de ces plages.\n' +
    '7. Ne compte pas la pause du midi comme du temps de travail effectif. Si une coupure existe, formule-la clairement.\n' +
    '8. Si la coupure du midi est suffisante, propose un seul sujet de brainstorm utile a faire avancer pendant cette pause.\n' +
    '9. Mentionne les evenements seulement s ils contraignent l execution.\n' +
    '10. Ne recopie pas les listes telles quelles: synthetise et tranche.\n\n' +
    'Le brief doit imperativement commencer mot pour mot par la phrase d ouverture fournie plus haut.\n' +
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

function formatWorkScheduleForPrompt(workSchedule, workSummary) {
  if (!workSchedule.length) {
    return 'Aucun horaire de travail renseigne.';
  }

  var summaryLine =
    'Travail: ' + formatParis(workSummary.firstStart, 'HH:mm') +
    ' -> ' + formatParis(workSummary.lastEnd, 'HH:mm') +
    ' (' + formatMinutesAsHourMinute(workSummary.totalMinutes) + ' d amplitude';

  if (workSummary.breakMinutes > 0) {
    summaryLine += ', dont ' + formatMinutesAsHourMinute(workSummary.breakMinutes) + ' de coupure';
  }

  summaryLine += ').';

  return (
    summaryLine + '\n' +
    workSchedule.map(function(event) {
      return '- ' + formatParis(event.start, 'HH:mm') + ' -> ' + formatParis(event.end, 'HH:mm') + ' : ' + event.title;
    }).join('\n')
  );
}

function buildWorkHeadline(workSummary) {
  if (!workSummary.hasWork) {
    return 'Aujourd hui, jour de repos.';
  }

  var headline =
    'Aujourd hui tu travailles de ' +
    formatParis(workSummary.firstStart, 'HH:mm') +
    ' a ' +
    formatParis(workSummary.lastEnd, 'HH:mm');

  if (workSummary.breakMinutes > 0) {
    headline += ' avec ' + formatMinutesAsNaturalFrench(workSummary.breakMinutes) + ' de coupe le midi.';
    return headline;
  }

  return headline + '.';
}

function buildDailyPlanningPrompt(context, criteria) {
  var planningCriteria = criteria || {};
  var criteriaLines = [
    'Objectif: proposer des slots concrets pour sport, travail perso et taches admin autour des horaires de travail.',
    'Moment de generation: ' + (planningCriteria.generationMoment || 'apres le brief du matin'),
    'Duree minimum d un slot: ' + (planningCriteria.minimumSlotMinutes || 30) + ' minutes',
    'Duree cible sport: ' + (planningCriteria.sportTargetMinutes || 'a definir'),
    'Duree cible travail perso: ' + (planningCriteria.personalWorkTargetMinutes || 'a definir'),
    'Duree cible taches admin: ' + (planningCriteria.adminTargetMinutes || 'a definir'),
    'Heure limite du soir: ' + (planningCriteria.latestEndTime || 'a definir'),
    'Regle energie: ' + (planningCriteria.energyRule || 'a definir'),
    'Regle arbitrage: ' + (planningCriteria.arbitrationRule || 'a definir')
  ];

  return [
    'CONTEXTE JOURNEE',
    'HORAIRES DE TRAVAIL:',
    formatWorkScheduleForPrompt(context.workSchedule || [], context.workSummary || summarizeWorkSchedule([])),
    '',
    'EVENEMENTS:',
    formatEventsForPrompt(context.events || []),
    '',
    'TACHES:',
    formatTasksForPrompt((context.tasksToday || []).concat(context.tasksOverdue || [])),
    '',
    'CRITERES',
    criteriaLines.join('\n'),
    '',
    'MISSION',
    'Propose des slots horaires ordonnes, realistes et compatibles avec les contraintes ci-dessus. Justifie tres brievement chaque slot.'
  ].join('\n');
}

function generateWeeklyPlanningWithOpenAI(openaiApiKey, prompts) {
  var data = callOpenAIChat(openaiApiKey, {
    model: 'gpt-4o-mini',
    temperature: 0.5,
    max_tokens: 900,
    messages: [
      { role: 'system', content: prompts.systemPrompt },
      { role: 'user', content: prompts.userPrompt }
    ]
  });

  return extractOpenAIText(data);
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
