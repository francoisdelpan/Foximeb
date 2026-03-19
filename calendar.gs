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

function eventsOverlap(leftEvent, rightEvent) {
  var leftStart = leftEvent.start.getTime();
  var leftEnd = leftEvent.end.getTime();
  var rightStart = rightEvent.start.getTime();
  var rightEnd = rightEvent.end.getTime();

  return leftStart < rightEnd && rightStart < leftEnd;
}
