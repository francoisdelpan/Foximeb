function sendBriefToDiscordChannels(config, briefPackage, audioBlob) {
  requireConfig(config, ['discordBriefWebhookUrl', 'discordPromptWebhookUrl']);
  var improvementCopyBlock;

  postDiscordJson(config.discordBriefWebhookUrl, {
    embeds: [buildBriefDiscordEmbed(briefPackage)]
  });

  if (audioBlob) {
    postDiscordMultipart(config.discordBriefWebhookUrl, {
      content: '🎧 Brief vocal du jour'
    }, audioBlob);
  }

  postDiscordJson(config.discordPromptWebhookUrl, {
    embeds: [buildPromptReviewDiscordEmbed(briefPackage)]
  });

  improvementCopyBlock = buildImprovementCopyBlock(briefPackage);

  if (improvementCopyBlock.length <= 2000) {
    postDiscordJson(config.discordPromptWebhookUrl, {
      content: improvementCopyBlock
    });
    return;
  }

  postDiscordMultipart(config.discordPromptWebhookUrl, {
    content: 'Bloc de copie trop long pour un message Discord. Je l envoie en fichier texte.'
  }, createTextBlob('brief_improvement_pack.txt', improvementCopyBlock));
}

function sendWeeklyPlanningToDiscord(config, planPackage) {
  requireConfig(config, ['discordWeeklyPlanningWebhookUrl']);

  postDiscordJson(config.discordWeeklyPlanningWebhookUrl, {
    embeds: [buildWeeklyPlanningDiscordEmbed(planPackage)]
  });
}

function sendDailyTrackingAlert(config, trackingStatus, customEmbed) {
  requireConfig(config, ['discordAlertWebhookUrl']);

  postDiscordJson(config.discordAlertWebhookUrl, {
    embeds: [customEmbed || buildDailyTrackingFallbackEmbed(trackingStatus)]
  });
}

function buildBriefDiscordEmbed(briefPackage) {
  return {
    title: 'Brief du jour',
    color: 3447003,
    description: truncateText(briefPackage.briefText, 4096),
    fields: [
      {
        name: 'Taches aujourd hui',
        value: String(briefPackage.context.tasksToday.length),
        inline: true
      },
      {
        name: 'Retards ouverts',
        value: String(briefPackage.context.tasksOverdue.length),
        inline: true
      },
      {
        name: 'Evenements',
        value: String(briefPackage.context.events.length),
        inline: true
      }
    ],
    footer: {
      text: 'Foximeb | ' + formatParis(new Date(), 'dd/MM/yyyy HH:mm')
    },
    timestamp: new Date().toISOString()
  };
}

function buildPromptReviewDiscordEmbed(briefPackage) {
  return {
    title: 'Atelier d amelioration du brief',
    color: 15844367,
    description: truncateText(briefPackage.selfReview.justification, 4096),
    fields: [
      {
        name: 'Note auto-critique',
        value: truncateText(briefPackage.selfReview.scoreLine, 1024),
        inline: true
      }
    ],
    footer: {
      text: 'Les blocs ci-dessous sont penses pour etre copies dans une autre IA.'
    },
    timestamp: new Date().toISOString()
  };
}

function buildWeeklyPlanningDiscordEmbed(planPackage) {
  return {
    title: 'Plan hebdo propose',
    color: 3066993,
    description: truncateText(planPackage.planText, 4096),
    fields: [
      {
        name: 'Semaine',
        value:
          'Semaine ' + String(planPackage.context.isoWeekNumber) + '\n' +
          formatParis(planPackage.context.weekStart, 'dd/MM') + ' -> ' + formatParis(planPackage.context.weekEnd, 'dd/MM'),
        inline: true
      },
      {
        name: 'Jours avec travail',
        value: String(planPackage.context.weekDays.filter(function(day) {
          return day.workSummary.hasWork;
        }).length),
        inline: true
      },
      {
        name: 'Focus',
        value: 'Sport, rando, Utema, menage',
        inline: true
      },
      {
        name: 'Incoherences',
        value: String(planPackage.context.inconsistencyCount || 0),
        inline: true
      },
      {
        name: 'Cible Semaine',
        value: planPackage.hydratedTarget || 'Cible indisponible',
        inline: false
      }
    ],
    footer: {
      text: 'Planification hebdo | ' + formatParis(new Date(), 'dd/MM/yyyy HH:mm')
    },
    timestamp: new Date().toISOString()
  };
}

function buildImprovementCopyBlock(briefPackage) {
  return (
    '```text\n' +
    'INSTRUCTION: ' + briefPackage.improvementPack.instructions + '\n\n' +
    'PROMPT: ' + briefPackage.improvementPack.prompt + '\n\n' +
    'RESULT: ' + briefPackage.improvementPack.result + '\n' +
    '```'
  );
}

function postDiscordJson(webhookUrl, body) {
  var response = fetchDiscordWithRetry(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error('Erreur Discord : ' + code + ' - ' + response.getContentText());
  }
}

function postDiscordMultipart(webhookUrl, body, fileBlob) {
  var response = fetchDiscordWithRetry(webhookUrl, {
    method: 'post',
    payload: {
      payload_json: JSON.stringify(body),
      file: fileBlob
    },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error('Erreur Discord fichier : ' + code + ' - ' + response.getContentText());
  }
}

function fetchDiscordWithRetry(webhookUrl, options) {
  var maxAttempts = 4;
  var attempt;
  var response;
  var code;
  var delayMs;

  for (attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = UrlFetchApp.fetch(webhookUrl, options);
    code = response.getResponseCode();

    if (code !== 429) {
      return response;
    }

    delayMs = getDiscordRetryDelayMs(response, attempt);
    Logger.log('Discord rate limit detecte, nouvelle tentative dans ' + delayMs + ' ms');
    Utilities.sleep(delayMs);
  }

  return response;
}

function getDiscordRetryDelayMs(response, attempt) {
  var headers = response.getAllHeaders ? response.getAllHeaders() : {};
  var retryAfter = readHeaderIgnoreCase(headers, 'Retry-After');
  var retryAfterMs = Number(retryAfter);

  if (!isNaN(retryAfterMs) && retryAfterMs > 0) {
    if (retryAfterMs < 1000) {
      return Math.ceil(retryAfterMs * 1000);
    }

    return Math.ceil(retryAfterMs);
  }

  return attempt * 5000;
}

function readHeaderIgnoreCase(headers, targetName) {
  var key;

  for (key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key) && String(key).toLowerCase() === String(targetName).toLowerCase()) {
      return headers[key];
    }
  }

  return '';
}
