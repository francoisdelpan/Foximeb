var APP_TIMEZONE = 'Europe/Paris';
var WORK_CALENDAR_ID_PROPERTY = 'WORK_CALENDAR_ID';
var WEEKLY_PLANNING_WEBHOOK_PROPERTY = 'DISCORD_WEEKLY_PLANNING_WEBHOOK_URL';
var GOOGLE_DAILY_TRACKING_FOLDER_ID_PROPERTY = 'GOOGLE_DAILY_TRACKING_FOLDER_ID';

function getScriptConfig() {
  var props = PropertiesService.getScriptProperties();
  var requiredTrackingProperties = props.getProperty('DAILY_TRACKING_REQUIRED_PROPERTIES');

  return {
    todoistApiToken: props.getProperty('TODOIST_API_TOKEN'),
    openaiApiKey: props.getProperty('OPENAI_API_KEY'),
    discordBriefWebhookUrl: props.getProperty('DISCORD_WEBHOOK_URL'),
    discordPromptWebhookUrl: props.getProperty('DISCORD_IMPROVEMENT_WEBHOOK_URL'),
    discordAlertWebhookUrl: props.getProperty('DISCORD_ALERT_WEBHOOK_URL') || props.getProperty('DISCORD_WEBHOOK_URL'),
    discordWeeklyPlanningWebhookUrl: props.getProperty(WEEKLY_PLANNING_WEBHOOK_PROPERTY) || props.getProperty('DISCORD_WEBHOOK_URL'),
    googleDailyTrackingFolderId: props.getProperty(GOOGLE_DAILY_TRACKING_FOLDER_ID_PROPERTY),
    workCalendarId: props.getProperty(WORK_CALENDAR_ID_PROPERTY),
    dailyTrackingRequiredProperties: requiredTrackingProperties
  };
}

function requireConfig(config, keys) {
  var missing = [];
  var i;

  for (i = 0; i < keys.length; i += 1) {
    if (!config[keys[i]]) {
      missing.push(keys[i]);
    }
  }

  if (missing.length) {
    throw new Error('Configuration manquante: ' + missing.join(', '));
  }
}

function isoDateParis(date) {
  return Utilities.formatDate(date, APP_TIMEZONE, 'yyyy-MM-dd');
}

function formatParis(date, pattern) {
  return Utilities.formatDate(date, APP_TIMEZONE, pattern);
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatMinutesAsHourMinute(totalMinutes) {
  var safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  var hours = Math.floor(safeMinutes / 60);
  var minutes = safeMinutes % 60;

  return pad2(hours) + 'h' + pad2(minutes);
}

function formatMinutesAsNaturalFrench(totalMinutes) {
  var safeMinutes = Math.max(0, Number(totalMinutes) || 0);
  var hours = Math.floor(safeMinutes / 60);
  var minutes = safeMinutes % 60;
  var parts = [];

  if (hours > 0) {
    parts.push(hours + 'h');
  }

  if (minutes > 0) {
    parts.push(pad2(minutes));
  }

  if (!parts.length) {
    return '0h';
  }

  return parts.join('');
}

function startOfParisDay(date) {
  var baseDate = date || new Date();
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0);
}

function addDays(date, days) {
  var result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function getNextWeekStart(date) {
  var baseDate = startOfParisDay(date || new Date());
  var day = baseDate.getDay();
  var daysUntilNextMonday = day === 0 ? 1 : 8 - day;

  return addDays(baseDate, daysUntilNextMonday);
}

function getIsoWeekNumber(date) {
  var target = new Date(date.getTime());
  var dayNr = (target.getDay() + 6) % 7;
  var firstThursday;

  target.setDate(target.getDate() - dayNr + 3);
  firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);

  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
}

function getFrenchWeekdayName(date) {
  var names = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return names[(date || new Date()).getDay()];
}

function daysBetweenParis(dateStr, todayStr) {
  var d1 = new Date(dateStr + 'T00:00:00');
  var d2 = new Date(todayStr + 'T00:00:00');
  var ms = d2.getTime() - d1.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function truncateText(text, maxLength) {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 3) + '...';
}

function splitTextIntoChunks(text, maxLength) {
  var chunks = [];
  var remaining = text || '';

  while (remaining.length > maxLength) {
    var splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function getPriorityRank(priority) {
  if (priority === 'P1') {
    return 1;
  }

  if (priority === 'P2') {
    return 2;
  }

  if (priority === 'P3') {
    return 3;
  }

  return 9;
}

function fetchJson(url, options) {
  var response = UrlFetchApp.fetch(url, options);
  var body = response.getContentText();
  var code = response.getResponseCode();
  var data;

  try {
    data = body ? JSON.parse(body) : {};
  } catch (error) {
    data = {};
  }

  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ' sur ' + url + ' : ' + body);
  }

  return data;
}

function createTextBlob(filename, content) {
  return Utilities.newBlob(content, 'text/plain', filename);
}

function getDefaultDailyTrackingRequiredProperties() {
  return [
    'Wake Up',
    'Go to bed',
    'Job',
    'Utema',
    'Digital Work',
    'Sport',
    'Ambiente'
  ];
}

function getDailyTrackingRequiredProperties(config) {
  var raw = config && config.dailyTrackingRequiredProperties;

  if (!raw) {
    return getDefaultDailyTrackingRequiredProperties();
  }

  return raw.split(',').map(function(item) {
    return String(item || '').trim();
  }).filter(function(item) {
    return Boolean(item);
  });
}

function extractGoogleDriveId(rawValue) {
  var value = String(rawValue || '').trim();
  var match;

  if (!value) {
    return '';
  }

  if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) {
    return value;
  }

  match = value.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
  if (match) {
    return match[1];
  }

  match = value.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (match) {
    return match[1];
  }

  match = value.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (match) {
    return match[1];
  }

  return value;
}

function getCalendarByIdOrDefault(calendarId) {
  if (!calendarId) {
    return CalendarApp.getDefaultCalendar();
  }

  return CalendarApp.getCalendarById(calendarId);
}
