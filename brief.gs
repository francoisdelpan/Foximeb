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
    workSummary: workSummary
  };
}

function getEventsForToday() {
  return getCalendarEventsForDate(null, new Date());
}

function getWorkSchedule(config, date) {
  if (!config.workCalendarId) {
    return [];
  }

  return getCalendarEventsForDate(config.workCalendarId, date);
}

function getCalendarEventsForDate(calendarId, date) {
  var calendar = getCalendarByIdOrDefault(calendarId);
  var now = new Date();
  var baseDate = date || now;
  var start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0);
  var end = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 1, 0, 0, 0);

  if (!calendar) {
    throw new Error('Agenda introuvable pour l ID: ' + calendarId);
  }

  return calendar.getEvents(start, end).map(function(event) {
    return {
      title: event.getTitle(),
      start: event.getStartTime(),
      end: event.getEndTime()
    };
  });
}

function summarizeWorkSchedule(workSchedule) {
  if (!workSchedule.length) {
    return {
      hasWork: false,
      firstStart: null,
      lastEnd: null,
      totalMinutes: 0,
      occupiedMinutes: 0,
      breakMinutes: 0,
      blockCount: 0
    };
  }

  var sortedSchedule = workSchedule.slice().sort(function(a, b) {
    return a.start.getTime() - b.start.getTime();
  });

  return sortedSchedule.reduce(function(summary, event, index) {
    var startTime = event.start.getTime();
    var endTime = event.end.getTime();
    var previousEvent;
    var gapMinutes;

    if (!summary.firstStart || startTime < summary.firstStart.getTime()) {
      summary.firstStart = event.start;
    }

    if (!summary.lastEnd || endTime > summary.lastEnd.getTime()) {
      summary.lastEnd = event.end;
    }

    summary.occupiedMinutes += Math.max(0, Math.round((endTime - startTime) / 60000));
    summary.hasWork = true;
    summary.blockCount += 1;

    if (index > 0) {
      previousEvent = sortedSchedule[index - 1];
      gapMinutes = Math.round((event.start.getTime() - previousEvent.end.getTime()) / 60000);

      if (gapMinutes > 0) {
        summary.breakMinutes += gapMinutes;
      }
    }

    summary.totalMinutes = Math.max(0, Math.round((summary.lastEnd.getTime() - summary.firstStart.getTime()) / 60000));

    return summary;
  }, {
    hasWork: false,
    firstStart: null,
    lastEnd: null,
    totalMinutes: 0,
    occupiedMinutes: 0,
    breakMinutes: 0,
    blockCount: 0
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
    'HORAIRES DE TRAVAIL:\n' + formatWorkScheduleForPrompt(context.workSchedule, context.workSummary) + '\n\n' +
    'TACHES AUJOURD HUI:\n' + formatTasksForPrompt(context.tasksToday) + '\n\n' +
    'RETARD:\n' + formatTasksForPrompt(context.tasksOverdue) + '\n\n' +
    'Regles de decision:\n' +
    '1. Les taches en retard J-1 doivent etre traitees comme des taches d aujourd hui.\n' +
    '2. Plus une tache est ancienne, moins elle est importante a priori.\n' +
    '3. Priorite P1 avant P2. Si une P1 est ancienne, impose une decision explicite: la faire aujourd hui ou la replanifier.\n' +
    '4. Donne un plan d attaque: premier bloc, deuxieme bloc, et ce qui peut attendre.\n' +
    '5. Limite les priorites du jour a 3 maximum.\n' +
    '6. Les horaires de travail sont une contrainte dure: le plan d attaque doit tenir autour de ces plages.\n' +
    '7. Ne compte pas la pause du midi comme du temps de travail effectif. Si une coupure existe, formule-la clairement.\n' +
    '8. Si la coupure du midi est suffisante, propose un seul sujet de brainstorm utile a faire avancer pendant cette pause.\n' +
    '9. Mentionne les evenements seulement s ils contraignent l execution.\n' +
    '10. Ne recopie pas les listes telles quelles: synthetise et tranche.\n\n' +
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

function runWeeklyPlanningWorkflow(options) {
  var workflowOptions = options || {};
  var config = getScriptConfig();

  requireConfig(config, [
    'notionApiKey',
    'notionTasksDatabaseId',
    'openaiApiKey',
    'discordWeeklyPlanningWebhookUrl'
  ]);

  var context = collectWeeklyPlanningContext(config, workflowOptions.referenceDate);
  var criteria = getDefaultWeeklyPlanningCriteria();
  var prompts = buildWeeklyPlanningPrompts(context, criteria);
  var planText = generateWeeklyPlanningWithOpenAI(config.openaiApiKey, prompts);
  var planPackage = {
    context: context,
    criteria: criteria,
    prompts: prompts,
    planText: planText
  };

  sendWeeklyPlanningToDiscord(config, planPackage);
  return planPackage;
}

function collectWeeklyPlanningContext(config, referenceDate) {
  var weekStart = getNextWeekStart(referenceDate || new Date());
  var weekEnd = addDays(weekStart, 6);
  var taskPack = getNotionTasksForDateWindow(config, weekStart, weekEnd);
  var weekDays = [];
  var offset;
  var date;
  var workSchedule;

  for (offset = 0; offset < 7; offset += 1) {
    date = addDays(weekStart, offset);
    workSchedule = getWorkSchedule(config, date);
    weekDays.push({
      date: date,
      isoDate: isoDateParis(date),
      label: formatParis(date, 'EEEE dd/MM'),
      workSchedule: workSchedule,
      workSummary: summarizeWorkSchedule(workSchedule),
      isSaturday: date.getDay() === 6,
      isSunday: date.getDay() === 0
    });
  }

  return {
    weekStart: weekStart,
    weekEnd: weekEnd,
    weekDays: weekDays,
    tasksUpcoming: taskPack.upcoming,
    tasksOverdue: taskPack.overdue
  };
}

function getDefaultWeeklyPlanningCriteria() {
  return {
    generationMoment: 'dimanche matin pour la semaine a venir',
    earliestStartTime: '06:30',
    breakfastBufferRule: 'Prevoir un petit dej avant le travail. La derniere heure avant prise de poste est une zone grise, a ne pas surcharger par du deepwork exigeant.',
    sportRule: 'Sport idealement en fin de journee. Slot minimum 60 minutes avec 30 minutes de transition apres la fin du travail. Fin de seance idealement au plus tard a 20:30. Alterner course et velo quand c est coherent.',
    hikeRule: 'Proposer une rando de 4 a 5 heures sur un jour de repos ou une apres-midi largement libre.',
    utemaRule: 'Pour Utema, plus le bloc est long mieux c est, surtout pour le code. Si pas possible, proposer des sessions de stratifi ou gestion en plus petits blocs. Idealement avant le travail seulement si le timing reste confortable avec petit dej.',
    splitShiftRule: 'Si le poste finit tot, reutiliser l apres-midi pour un gros bloc deepwork, par exemple apres une prise de poste 06:45-14:00 viser 14:30-18:30.',
    cleaningRule: 'Le samedi, reserver un slot menage de 3 heures, avec fin ideale avant 20:00.',
    screenCutoff: '22:00',
    outputRule: 'Produire un recap court, propre, lisible, centre sur les vrais slots de la semaine.'
  };
}

function buildWeeklyPlanningPrompts(context, criteria) {
  var systemPrompt =
    'Tu es Foximeb, assistant de planification hebdomadaire. ' +
    'Tu proposes une semaine realiste, executable et dense, sans blabla. ' +
    'Tu optimises l energie, la faisabilite et la clarte. ' +
    'Tu t adresses a Francois au tutoiement. ' +
    'Tu privilegies de vrais blocs exploitables plutot que du remplissage.';

  var userPrompt =
    'Planifie la semaine a venir a partir des contraintes ci-dessous.\n\n' +
    'SEMAINE:\n' + formatWeeklyWorkScheduleForPrompt(context.weekDays) + '\n\n' +
    'TACHES A PRENDRE EN COMPTE:\n' + formatWeeklyTasksForPrompt(context.tasksUpcoming, context.tasksOverdue) + '\n\n' +
    'CRITERES:\n' +
    '- Heure de debut possible le matin: ' + criteria.earliestStartTime + '\n' +
    '- Petit dej: ' + criteria.breakfastBufferRule + '\n' +
    '- Sport: ' + criteria.sportRule + '\n' +
    '- Rando: ' + criteria.hikeRule + '\n' +
    '- Utema: ' + criteria.utemaRule + '\n' +
    '- Cas poste du matin: ' + criteria.splitShiftRule + '\n' +
    '- Menage samedi: ' + criteria.cleaningRule + '\n' +
    '- Fin des ecrans: ' + criteria.screenCutoff + '\n' +
    '- Format de sortie: ' + criteria.outputRule + '\n\n' +
    'Regles de decision:\n' +
    '1. Respecte strictement les plages de travail.\n' +
    '2. Ne colle pas de sport immediatement a la sortie du travail: garde 30 minutes de tampon.\n' +
    '3. Le deepwork code doit etre groupe en gros blocs quand possible.\n' +
    '4. Si un jour est trop charge, reduis d abord les petites gestions avant de casser un gros bloc deepwork utile.\n' +
    '5. Propose au maximum une rando sur la semaine, seulement si le contexte la rend realiste.\n' +
    '6. Rends la semaine lisible jour par jour avec horaires proposes et une justification ultra courte.\n' +
    '7. Termine par une section tres courte: arbitrages majeurs de la semaine.\n\n' +
    'Ecris uniquement le plan hebdomadaire final.';

  return {
    systemPrompt: systemPrompt,
    userPrompt: userPrompt
  };
}

function formatWeeklyWorkScheduleForPrompt(weekDays) {
  return weekDays.map(function(day) {
    return day.label + '\n' + indentMultiline(formatWorkScheduleForPrompt(day.workSchedule, day.workSummary), '  ');
  }).join('\n\n');
}

function formatWeeklyTasksForPrompt(tasksUpcoming, tasksOverdue) {
  var lines = [];

  if (tasksOverdue && tasksOverdue.length) {
    lines.push('RETARDS');
    lines.push(formatTasksForPrompt(tasksOverdue));
  }

  if (tasksUpcoming && tasksUpcoming.length) {
    lines.push('A VENIR CETTE SEMAINE');
    lines.push(formatTasksForPrompt(tasksUpcoming));
  }

  if (!lines.length) {
    return 'Aucune tache datee ouverte sur la semaine.';
  }

  return lines.join('\n');
}

function indentMultiline(text, prefix) {
  return String(text || '').split('\n').map(function(line) {
    return prefix + line;
  }).join('\n');
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
