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

function sendDailyTrackingAlert(config, trackingStatus) {
  requireConfig(config, ['discordBriefWebhookUrl']);

  postDiscordJson(config.discordBriefWebhookUrl, {
    embeds: [{
      title: 'Daily Tracking incomplet',
      color: 15158332,
      description: trackingStatus.exists
        ? 'La ligne du jour existe, mais elle ne semble pas remplie.'
        : 'Aucune ligne du jour n a ete trouvee dans Daily Tracking.',
      fields: [
        {
          name: 'Date',
          value: trackingStatus.date,
          inline: true
        },
        {
          name: 'Entree',
          value: truncateText(trackingStatus.title || 'Daily Tracking', 1024),
          inline: true
        },
        {
          name: 'Champs obligatoires manquants',
          value: trackingStatus.missingProperties && trackingStatus.missingProperties.length
            ? truncateText(trackingStatus.missingProperties.map(function(item) {
                return '- ' + item;
              }).join('\n'), 1024)
            : 'Aucun champ identifie',
          inline: false
        }
      ],
      footer: {
        text: 'Rappel automatique 22:00'
      },
      timestamp: new Date().toISOString(),
      url: trackingStatus.url || undefined
    }]
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
  var response = UrlFetchApp.fetch(webhookUrl, {
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
  var response = UrlFetchApp.fetch(webhookUrl, {
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
