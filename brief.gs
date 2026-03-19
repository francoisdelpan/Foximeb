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

function runWeeklyPlanningWorkflow(options) {
  var workflowOptions = options || {};
  var config = getScriptConfig();

  requireConfig(config, [
    'discordWeeklyPlanningWebhookUrl'
  ]);

  var context = collectWeeklyPlanningContext(config, workflowOptions.referenceDate);
  var criteria = getDefaultWeeklyPlanningCriteria();
  var prompts = buildWeeklyPlanningPrompts(context, criteria);
  var planRender = buildWeeklyPlanText(context, criteria);
  var planPackage = {
    context: context,
    criteria: criteria,
    prompts: prompts,
    planText: planRender.text,
    hydratedTarget: planRender.hydratedTarget
  };

  sendWeeklyPlanningToDiscord(config, planPackage);
  return planPackage;
}

function collectWeeklyPlanningContext(config, referenceDate) {
  var weekStart = getNextWeekStart(referenceDate || new Date());
  var weekEnd = addDays(weekStart, 6);
  var weekDays = [];
  var offset;
  var date;
  var workSchedule;
  var defaultEvents;
  var normalizedWorkDay;
  var inconsistencyCount = 0;

  for (offset = 0; offset < 7; offset += 1) {
    date = addDays(weekStart, offset);
    workSchedule = getWorkSchedule(config, date);
    defaultEvents = getCalendarEventsForDate(null, date);
    normalizedWorkDay = normalizeWeeklyWorkDay(workSchedule);
    inconsistencyCount += countScheduleConflicts(normalizedWorkDay.workSchedule, defaultEvents);
    weekDays.push({
      date: date,
      isoDate: isoDateParis(date),
      label: getFrenchWeekdayName(date) + ' ' + formatParis(date, 'dd/MM'),
      workSchedule: normalizedWorkDay.workSchedule,
      workSummary: normalizedWorkDay.workSummary,
      workLabel: normalizedWorkDay.workLabel,
      defaultEvents: defaultEvents,
      isSaturday: date.getDay() === 6,
      isSunday: date.getDay() === 0
    });
  }

  return {
    weekStart: weekStart,
    weekEnd: weekEnd,
    weekDays: weekDays,
    inconsistencyCount: inconsistencyCount,
    weeklyTargets: getWeeklyTargets(),
    isoWeekNumber: getIsoWeekNumber(weekStart)
  };
}

function normalizeWeeklyWorkDay(workSchedule) {
  var summary = summarizeWorkSchedule(workSchedule);
  var hasFullDayRh = workSchedule.some(function(event) {
    return isRhRestEvent(event.title);
  });

  if (hasFullDayRh) {
    return {
      workSchedule: [],
      workSummary: summarizeWorkSchedule([]),
      workLabel: 'Repos Bricoman (RH toute la journee)'
    };
  }

  if (!summary.hasWork) {
    return {
      workSchedule: [],
      workSummary: summary,
      workLabel: 'Repos Bricoman'
    };
  }

  return {
    workSchedule: [{
      title: 'Bricoman',
      start: summary.firstStart,
      end: summary.lastEnd
    }],
    workSummary: summary,
    workLabel: 'Bricoman: ' + formatParis(summary.firstStart, 'HH:mm') + ' -> ' + formatParis(summary.lastEnd, 'HH:mm')
  };
}

function isRhRestEvent(title) {
  return /\bRH\b/i.test(String(title || ''));
}

function getDefaultWeeklyPlanningCriteria() {
  return {
    generationMoment: 'dimanche matin pour la semaine a venir',
    earliestStartTime: '06:30',
    breakfastBufferRule: 'Prevoir un petit dej avant le travail. Si la prise de poste est avant 09:00, placer plutot le petit dej juste avant le depart et utiliser 06:30 comme debut possible pour un bloc deepwork.',
    sportRule: 'Sport idealement en fin de journee. Slot minimum 60 minutes avec 30 minutes de transition apres la fin du travail. Fin de seance idealement au plus tard a 20:30. Sport non obligatoire tous les jours: viser plutot 3 a 4 seances sur la semaine. Alterner course et velo quand c est coherent, mais savoir sauter une seance si Utema doit etre privilegie.',
    hikeRule: 'Proposer une seule rando de 5 heures sur un jour de repos ou une apres-midi largement libre.',
    utemaRule: 'Pour Utema, plus le bloc est long mieux c est, surtout pour le code. Si pas possible, proposer des sessions de Stratif ou gestion en plus petits blocs. Si la journee contient deja beaucoup de Utema, privilegier plutot du Creatif en fin de journee.',
    splitShiftRule: 'Si le poste finit tot, reutiliser l apres-midi pour un gros bloc deepwork, par exemple apres une prise de poste 06:45-14:00 viser 14:30-18:30. Un jour de repos peut aussi accueillir du sport, du deepwork, du menage ou une rando.',
    cleaningRule: 'Essayer de reserver le menage sur le samedi avec un vrai slot de 3 heures. Si ce slot de 3 heures ne rentre pas, il faut le reporter ailleurs dans la semaine et l ecrire explicitement en REPORT.',
    outputRule: 'Produire un recap court, propre, lisible, centre sur les vrais slots de la semaine.'
  };
}

function getWeeklyTargets() {
  return {
    bricomanHours: 35,
    sportSessions: '3-4 + 1 rando',
    utemaHours: 25
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
    'TITRE ATTENDU:\n' + 'Semaine n ' + String(context.isoWeekNumber) + ' (' + formatParis(context.weekStart, 'dd/MM') + ' - ' + formatParis(context.weekEnd, 'dd/MM') + ')\n\n' +
    'SEMAINE:\n' + formatWeeklyWorkScheduleForPrompt(context.weekDays) + '\n\n' +
    'EVENEMENTS A PRENDRE EN COMPTE:\n' + formatWeeklyDefaultEventsForPrompt(context.weekDays) + '\n\n' +
    'CIBLE S24:\n' + formatWeeklyTargetsForPrompt(context.weeklyTargets) + '\n\n' +
    'INCOHERENCES AGENDA DETECTEES:\n' + String(context.inconsistencyCount) + '\n\n' +
    'CRITERES:\n' +
    '- Heure de debut possible le matin: ' + criteria.earliestStartTime + '\n' +
    '- Petit dej: ' + criteria.breakfastBufferRule + '\n' +
    '- Sport: ' + criteria.sportRule + '\n' +
    '- Rando: ' + criteria.hikeRule + '\n' +
    '- Utema: ' + criteria.utemaRule + '\n' +
    '- Cas poste du matin: ' + criteria.splitShiftRule + '\n' +
    '- Menage samedi: ' + criteria.cleaningRule + '\n' +
    '- Format de sortie: ' + criteria.outputRule + '\n\n' +
    'Regles de decision:\n' +
    '1. Respecte strictement les plages de travail.\n' +
    '2. Ne colle pas de sport immediatement a la sortie du travail: garde 30 minutes de tampon.\n' +
    '3. Le deepwork code doit etre groupe en gros blocs quand possible.\n' +
    '4. Le plan ne doit pas planifier les taches Notion une par une. Il doit seulement proposer des slots de sport, deepwork Utema, une rando eventuelle et le menage du samedi.\n' +
    '5. Si un jour est trop charge, reduis d abord les petites gestions avant de casser un gros bloc deepwork utile.\n' +
    '6. RH toute la journee veut dire repos Bricoman.\n' +
    '7. N invente jamais de bloc detente. Soit tu ne mets rien, soit tu proposes un slot utile qui remplit une des categories autorisees.\n' +
    '8. Le sport n est pas obligatoire tous les jours.\n' +
    '9. Propose au maximum une rando sur la semaine, seulement si le contexte la rend realiste.\n' +
    '10. Un jour de repos Bricoman peut et doit etre utilise si pertinent pour proposer du sport, du deepwork, du menage ou une rando.\n' +
    '11. Si un evenement perso chevauche une plage de travail, signale-le visuellement en GRAS avec le mot ALERTE et rappelle qu il faut annuler, deplacer ou reprogrammer cet evenement perso. Le travail reste prioritaire.\n' +
    '12. Si le menage ne rentre pas le samedi, propose un autre slot ailleurs dans la semaine.\n' +
    '13. Utilise de preference le format horaire compact HHMM - HHMM, sans deux-points, pour les slots proposes. Garde Bricoman au format HHMM - HHMM sur une seule ligne.\n' +
    '14. Si un jour commence par du deepwork matinal avant une prise de poste tot, place ensuite explicitement un slot Petit dejeuner juste avant le depart au travail.\n' +
    '15. Quand Utema est propose, nomme le type de bloc si possible: Utema - Code, Utema - Stratif, ou Utema - Creatif.\n' +
    '16. Ne propose pas de dejeuner, diner ou petit dejeuner sauf si cela structure directement la faisabilite d une journee chargee ou d un depart tot.\n' +
    '17. Rends la semaine lisible jour par jour avec horaires proposes et une justification ultra courte.\n' +
    '18. Termine par trois lignes courtes: ARBITRAGES MAJEURS, COMPTEUR INCOHERENCES, et CIBLE POUR CETTE SEMAINE. Cette derniere ligne doit recapituluer les heures et seances reellement programmees dans le plan.\n' +
    '19. Le titre doit reprendre exactement le numero de semaine fourni plus haut.\n' +
    'Ecris uniquement le plan hebdomadaire final.';

  return {
    systemPrompt: systemPrompt,
    userPrompt: userPrompt
  };
}

function formatWeeklyWorkScheduleForPrompt(weekDays) {
  return weekDays.map(function(day) {
    return day.label + '\n' + indentMultiline(day.workLabel, '  ');
  }).join('\n\n');
}

function formatWeeklyDefaultEventsForPrompt(weekDays) {
  var lines = [];

  weekDays.forEach(function(day) {
    lines.push(day.label);

    if (!day.defaultEvents || !day.defaultEvents.length) {
      lines.push('  - Aucun evenement general');
      return;
    }

    day.defaultEvents.forEach(function(event) {
      lines.push('  - ' + formatParis(event.start, 'HH:mm') + ' -> ' + formatParis(event.end, 'HH:mm') + ' : ' + event.title);
    });
  });

  return lines.join('\n');
}

function formatWeeklyTargetsForPrompt(targets) {
  return (
    '- Heures Bricoman: ' + String(targets.bricomanHours) + 'h\n' +
    '- Sport: ' + String(targets.sportSessions) + ' seances\n' +
    '- Utema: ' + String(targets.utemaHours) + 'h'
  );
}

function buildWeeklyPlanText(context, criteria) {
  var planningState = {
    sportSessions: 0,
    hikeCount: 0,
    utemaMinutes: 0,
    cleaningReported: false,
    cleaningDone: false,
    dayPlans: []
  };
  var workMinutes = context.weekDays.reduce(function(total, day) {
    return total + (day.workSummary.occupiedMinutes || 0);
  }, 0);
  var dayIndex;

  for (dayIndex = 0; dayIndex < context.weekDays.length; dayIndex += 1) {
    planningState.dayPlans.push(buildWeeklyDayPlan(context.weekDays[dayIndex], dayIndex, planningState, criteria));
  }

  return buildWeeklyPlanRenderResult(context, planningState, workMinutes);
}

function buildWeeklyDayPlan(day, dayIndex, planningState, criteria) {
  var items = [];
  var weekday = day.date.getDay();
  var startMinute = day.workSummary.hasWork ? getMinutesSinceMidnight(day.workSummary.firstStart) : null;
  var endMinute = day.workSummary.hasWork ? getMinutesSinceMidnight(day.workSummary.lastEnd) : null;
  var isEarlyWorkday = day.workSummary.hasWork && startMinute < (9 * 60);
  var isAfternoonShift = day.workSummary.hasWork && startMinute >= (13 * 60);
  var fixedEvents = buildFixedEventItems(day);

  if (weekday === 1 && !day.workSummary.hasWork) {
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '06:30', '08:00', 'Utema - Stratif', 'utema_stratif'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '08:00', '08:30', 'Petit dejeuner', 'meal'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '08:30', '12:00', 'Utema - Code', 'utema_code'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '12:00', '13:00', 'Dejeuner', 'meal'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '13:00', '17:00', 'Utema - Code', 'utema_code'));
    if (planningState.sportSessions < 4) {
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '17:00', '18:00', 'Sport', 'sport'));
    }
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '18:00', '19:00', 'Diner', 'meal'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '19:00', '22:00', 'Utema - Creatif', 'utema_creatif'));
  } else if (isAfternoonShift) {
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '06:30', '08:00', 'Utema - Stratif', 'utema_stratif'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '08:00', '08:30', 'Petit dejeuner', 'meal'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '08:30', '12:00', 'Utema - Code', 'utema_code'));
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '12:00', '13:00', 'Dejeuner', 'meal'));
    if (planningState.sportSessions < 4) {
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 30), addMinutesToTime(endMinute, 90), 'Sport - Course', 'sport'));
    }
    tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 90), addMinutesToTime(endMinute, 180), 'Diner', 'meal'));
  } else if (day.workSummary.hasWork) {
    if (isEarlyWorkday) {
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '06:30', '07:30', 'Utema', 'utema_code'));
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '07:30', '08:00', 'Petit dejeuner', 'meal'));
    }

    if (weekday === 2) {
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 30), addMinutesToTime(endMinute, 90), 'Diner', 'meal'));
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 90), '22:00', 'Utema - Code', 'utema_code'));
    } else if (weekday === 3 || weekday === 5) {
      if (planningState.sportSessions < 4) {
        tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 30), addMinutesToTime(endMinute, 90), weekday === 3 ? 'Sport - Velo' : 'Sport - Velo', 'sport'));
      }
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 90), addMinutesToTime(endMinute, 150), 'Diner', 'meal'));
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 150), '22:00', 'Utema - Code', 'utema_code'));
    } else if (weekday === 6) {
      if (isEarlyWorkday) {
        tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '06:30', '07:30', 'Utema', 'utema_code'));
        tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '07:30', '08:00', 'Petit dejeuner', 'meal'));
      }

      if (!tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, addMinutesToTime(endMinute, 30), addMinutesToTime(endMinute, 210), 'Menage', 'cleaning'))) {
        planningState.cleaningReported = true;
        items.push(createUntimedPlanItem('(REPORT) Menage'));
      } else {
        planningState.cleaningDone = true;
      }
    }
  } else if (weekday === 0) {
    if (planningState.cleaningReported) {
      if (tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '06:30', '09:30', '(REPORT) Menage', 'cleaning'))) {
        planningState.cleaningDone = true;
      }
    }

    if (planningState.hikeCount < 1) {
      tryAddTimedItem(items, fixedEvents, createTimedPlanItem(day, '14:30', '19:30', 'Rando', 'hike'));
    }
  }

  updatePlanningCountersFromItems(items, planningState);

  return {
    day: day,
    fixedEvents: fixedEvents,
    plannedItems: items
  };
}

function buildFixedEventItems(day) {
  return (day.defaultEvents || []).map(function(event) {
    var overlapsWork = (day.workSchedule || []).some(function(workEvent) {
      return eventsOverlap(workEvent, event);
    });

    return {
      startMinutes: getMinutesSinceMidnight(event.start),
      endMinutes: getMinutesSinceMidnight(event.end),
      label: truncateText(event.title, 120),
      kind: 'event',
      prefix: overlapsWork ? '(ALERTE) ' : '',
      conflict: overlapsWork
    };
  });
}

function createTimedPlanItem(day, startTime, endTime, label, kind) {
  return {
    startMinutes: parseTimeToMinutes(startTime),
    endMinutes: parseTimeToMinutes(endTime),
    label: label,
    kind: kind || 'generic',
    prefix: ''
  };
}

function createUntimedPlanItem(label) {
  return {
    startMinutes: null,
    endMinutes: null,
    label: label,
    kind: 'note',
    prefix: ''
  };
}

function tryAddTimedItem(items, fixedEvents, item) {
  if (!item) {
    return false;
  }

  if (item.startMinutes === null || item.endMinutes === null || item.endMinutes <= item.startMinutes) {
    return false;
  }

  if (hasAnyOverlap(items, item) || hasAnyOverlap(fixedEvents, item)) {
    return false;
  }

  items.push(item);
  return true;
}

function hasAnyOverlap(existingItems, candidate) {
  return (existingItems || []).some(function(existingItem) {
    if (existingItem.startMinutes === null || existingItem.endMinutes === null) {
      return false;
    }

    return existingItem.startMinutes < candidate.endMinutes && candidate.startMinutes < existingItem.endMinutes;
  });
}

function updatePlanningCountersFromItems(items, planningState) {
  items.forEach(function(item) {
    if (item.kind === 'sport') {
      planningState.sportSessions += 1;
    }

    if (item.kind === 'hike') {
      planningState.hikeCount += 1;
    }

    if (/^utema/i.test(item.label)) {
      planningState.utemaMinutes += Math.max(0, item.endMinutes - item.startMinutes);
    }
  });
}

function renderWeeklyPlanText(context, planningState, workMinutes) {
  return buildWeeklyPlanRenderResult(context, planningState, workMinutes).text;
}

function buildWeeklyPlanRenderResult(context, planningState, workMinutes) {
  var lines = [];
  var totalSportLabel = String(planningState.sportSessions) + ' seances' + (planningState.hikeCount ? ' + ' + String(planningState.hikeCount) + ' rando' : '');
  var hydratedTarget =
    'Bricoman **' + formatMinutesAsNaturalFrench(workMinutes) + '**\n' +
    'Sport **' + totalSportLabel + '**\n' +
    'Utema **' + formatMinutesAsNaturalFrench(planningState.utemaMinutes) + '**';

  lines.push('Semaine ' + String(context.isoWeekNumber) + ' (' + formatParis(context.weekStart, 'dd/MM') + ' - ' + formatParis(context.weekEnd, 'dd/MM') + ')');
  lines.push('');

  planningState.dayPlans.forEach(function(dayPlan) {
    lines = lines.concat(renderWeeklyDayLines(dayPlan));
    lines.push('');
  });

  lines.push('ARBITRAGES MAJEURS : ' + buildWeeklyArbitrageLine(planningState));
  lines.push('COMPTEUR INCOHERENCES : ' + String(context.inconsistencyCount) + '.');

  return {
    text: lines.join('\n').trim(),
    hydratedTarget: hydratedTarget
  };
}

function renderWeeklyDayLines(dayPlan) {
  var lines = [];
  var items = [];

  lines.push('**' + capitalizeFirst(dayPlan.day.label) + '**');

  if (dayPlan.day.workSummary.hasWork) {
    items.push({
      startMinutes: dayPlan.day.workSchedule[0].start ? getMinutesSinceMidnight(dayPlan.day.workSchedule[0].start) : null,
      endMinutes: dayPlan.day.workSchedule[0].end ? getMinutesSinceMidnight(dayPlan.day.workSchedule[0].end) : null,
      label: dayPlan.day.workLabel,
      kind: 'workLabel'
    });
  } else {
    lines.push(dayPlan.day.workLabel);
  }

  items = items.concat(dayPlan.fixedEvents).concat(dayPlan.plannedItems).sort(comparePlanItems);

  items.forEach(function(item) {
    if (item.kind === 'workLabel') {
      lines.push(item.label + ' (' + formatDurationLabel(item.startMinutes, item.endMinutes) + ')');
      return;
    }

    if (item.startMinutes === null || item.endMinutes === null) {
      lines.push(String(item.prefix || '') + item.label);
      return;
    }

    lines.push(String(item.prefix || '') + formatCompactMinutes(item.startMinutes) + ' - ' + formatCompactMinutes(item.endMinutes) + ' : ' + formatPlanItemLabel(item));
  });

  return lines;
}

function comparePlanItems(leftItem, rightItem) {
  var leftStart = leftItem.startMinutes === null ? 9999 : leftItem.startMinutes;
  var rightStart = rightItem.startMinutes === null ? 9999 : rightItem.startMinutes;

  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }

  return (leftItem.endMinutes || 0) - (rightItem.endMinutes || 0);
}

function buildWeeklyArbitrageLine(planningState) {
  if (planningState.cleaningReported) {
    return 'Report du Menage.';
  }

  return 'Equilibre entre Utema et sport.';
}

function formatPlanItemLabel(item) {
  var label = String(item.label || '');
  var kindsWithDuration = {
    utema_code: true,
    utema_stratif: true,
    utema_creatif: true,
    cleaning: true,
    hike: true
  };

  if (!kindsWithDuration[item.kind]) {
    return label;
  }

  return label + ' (' + formatDurationLabel(item.startMinutes, item.endMinutes) + ')';
}

function formatDurationLabel(startMinutes, endMinutes) {
  var durationMinutes = Math.max(0, (endMinutes || 0) - (startMinutes || 0));
  var hours = Math.floor(durationMinutes / 60);
  var minutes = durationMinutes % 60;

  if (minutes === 0) {
    return String(hours) + 'h';
  }

  return String(hours) + 'h' + pad2(minutes);
}

function parseTimeToMinutes(timeValue) {
  if (typeof timeValue === 'number') {
    return timeValue;
  }

  var match = String(timeValue || '').match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return 0;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function addMinutesToTime(startMinutes, deltaMinutes) {
  return (startMinutes || 0) + deltaMinutes;
}

function getMinutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatCompactMinutes(totalMinutes) {
  var safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  var hours = Math.floor(safeMinutes / 60);
  var minutes = safeMinutes % 60;

  return pad2(hours) + pad2(minutes);
}

function capitalizeFirst(text) {
  var value = String(text || '');

  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function countScheduleConflicts(workSchedule, defaultEvents) {
  var count = 0;

  (defaultEvents || []).forEach(function(defaultEvent) {
    if (isRhRestEvent(defaultEvent.title)) {
      return;
    }

    if ((workSchedule || []).some(function(workEvent) {
      return eventsOverlap(workEvent, defaultEvent);
    })) {
      count += 1;
    }
  });

  return count;
}

function eventsOverlap(leftEvent, rightEvent) {
  var leftStart = leftEvent.start.getTime();
  var leftEnd = leftEvent.end.getTime();
  var rightStart = rightEvent.start.getTime();
  var rightEnd = rightEvent.end.getTime();

  return leftStart < rightEnd && rightStart < leftEnd;
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
