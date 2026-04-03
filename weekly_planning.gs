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
    '4. Le plan ne doit pas planifier les taches Todoist une par une. Il doit seulement proposer des slots de sport, deepwork Utema, une rando eventuelle et le menage du samedi.\n' +
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

function indentMultiline(text, prefix) {
  return String(text || '').split('\n').map(function(line) {
    return prefix + line;
  }).join('\n');
}
