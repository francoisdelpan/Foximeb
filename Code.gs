function generateDailyBrief() {
  return runDailyBriefWorkflow();
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

function testBriefDiscordOutputs() {
  return runDailyBriefWorkflow({
    skipTts: true
  });
}
