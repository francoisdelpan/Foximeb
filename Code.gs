function generateDailyBrief() {
  return runDailyBriefWorkflow();
}

function generateWeeklyPlan() {
  return runWeeklyPlanningWorkflow();
}

function sendDailyTrackingReminderIfMissing() {
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

function testWeeklyPlan() {
  return runWeeklyPlanningWorkflow();
}
