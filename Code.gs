function generateDailyBrief() {
  return runDailyBriefWorkflow();
}

function generateWeeklyPlan() {
  return runWeeklyPlanningWorkflow();
}

function sendDailyTrackingReminderIfMissing() {
  return runDailyTrackingReminderWorkflow();
}

function testDailyTrackingReminderFromDrive() {
  return runDailyTrackingReminderWorkflow();
}

function setupDailyTrackingReminderTrigger() {
  var triggerName = 'sendDailyTrackingReminderIfMissing';
  var triggers = ScriptApp.getProjectTriggers();
  var i;

  for (i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === triggerName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(triggerName)
    .timeBased()
    .everyDays(1)
    .atHour(22)
    .nearMinute(0)
    .create();
}

function setupWeeklyPlanningTrigger() {
  var triggerName = 'generateWeeklyPlan';
  var triggers = ScriptApp.getProjectTriggers();
  var i;

  for (i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === triggerName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(triggerName)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(9)
    .nearMinute(0)
    .create();
}

function testBriefDiscordOutputs() {
  return runDailyBriefWorkflow({
    skipTts: true
  });
}

function testTodoistTasksForToday() {
  var config = getScriptConfig();
  var payload = getTodoistTasksTodayAndOverdue(config);

  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}

function testWeeklyPlan() {
  return runWeeklyPlanningWorkflow();
}

function testWorkCalendar() {
  var config = getScriptConfig();
  var today = new Date();
  var calendar = getCalendarByIdOrDefault(config.workCalendarId);
  var events;
  var payload;

  if (!config.workCalendarId) {
    throw new Error('WORK_CALENDAR_ID manquant dans Script Properties.');
  }

  if (!calendar) {
    throw new Error('Aucun agenda trouve pour WORK_CALENDAR_ID=' + config.workCalendarId);
  }

  events = getWorkSchedule(config, today);
  payload = {
    workCalendarId: config.workCalendarId,
    calendarName: calendar.getName(),
    timezone: calendar.getTimeZone ? calendar.getTimeZone() : 'unknown',
    date: formatParis(today, 'yyyy-MM-dd'),
    eventCountToday: events.length,
    events: events.map(function(event) {
      return {
        title: event.title,
        start: formatParis(event.start, 'yyyy-MM-dd HH:mm'),
        end: formatParis(event.end, 'yyyy-MM-dd HH:mm')
      };
    })
  };

  Logger.log(JSON.stringify(payload, null, 2));
  return payload;
}
