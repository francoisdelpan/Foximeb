function getDailyTrackingStatusFromDrive(config, date) {
  requireConfig(config, ['googleDailyTrackingFileId']);

  var targetDate = date || new Date();
  var isoToday = isoDateParis(targetDate);
  var requiredProperties = getDailyTrackingRequiredProperties(config);
  var fileId = extractGoogleDriveFileId(config.googleDailyTrackingFileId);
  var file = null;
  var content;
  var parsedFile;
  var entry;
  var assessment;

  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    file = null;
  }

  if (!file) {
    return {
      date: isoToday,
      exists: false,
      completed: false,
      title: 'Fichier introuvable',
      sourceType: 'google-drive',
      sourceName: 'DAILY-TRACKING.base',
      missingProperties: requiredProperties.slice(),
      notes: ['Le fichier Daily Tracking est introuvable avec l identifiant ou l URL configuree.']
    };
  }

  content = readDriveFileContent(file);
  parsedFile = parseDailyTrackingEntries(content);
  entry = findDailyTrackingEntryForDate(parsedFile.entries, isoToday);
  assessment = assessDailyTrackingEntry(entry, requiredProperties, isoToday);

  assessment.sourceType = 'google-drive';
  assessment.sourceName = file.getName();
  assessment.fileId = file.getId();
  assessment.url = file.getUrl();
  assessment.rawContent = content;
  assessment.availableEntryDates = parsedFile.entries.map(function(item) {
    return item.date;
  });

  return assessment;
}

function readDriveFileContent(file) {
  var mimeType = file.getMimeType();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(file.getId()).getBody().getText();
  }

  return file.getBlob().getDataAsString();
}

function parseDailyTrackingEntries(content) {
  var normalized = String(content || '').replace(/\r\n/g, '\n');
  var lines = normalized.split('\n');
  var entries = [];
  var current = null;
  var i;
  var line;
  var dateMatch;
  var fieldMatch;

  for (i = 0; i < lines.length; i += 1) {
    line = lines[i].trim();

    if (!line) {
      continue;
    }

    dateMatch = extractDateFromLine(line);
    if (dateMatch) {
      if (current) {
        entries.push(current);
      }

      current = {
        date: dateMatch,
        title: line,
        fields: {},
        lines: []
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line);
    fieldMatch = parseTrackingFieldLine(line);

    if (fieldMatch) {
      current.fields[fieldMatch.name] = fieldMatch.value;
    }
  }

  if (current) {
    entries.push(current);
  }

  return {
    entries: entries
  };
}

function extractDateFromLine(line) {
  var match = String(line || '').match(/(?:^|[^0-9])(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})(?:[^0-9]|$)/);
  var normalized;
  var parts;

  if (!match) {
    return '';
  }

  normalized = match[1];
  if (normalized.indexOf('/') >= 0) {
    parts = normalized.split('/');
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }

  return normalized;
}

function parseTrackingFieldLine(line) {
  var cleaned = String(line || '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\[(?:x|X| )\]\s*/, '')
    .replace(/^\d+\.\s*/, '');
  var match = cleaned.match(/^([^:=-]+?)\s*(?::|=|-)\s*(.+)$/);
  var checkboxMatch;

  if (match) {
    return {
      name: normalizeTrackingFieldName(match[1]),
      value: String(match[2] || '').trim()
    };
  }

  checkboxMatch = String(line || '').match(/^[-*]\s*\[(x|X| )\]\s*(.+)$/);
  if (checkboxMatch) {
    return {
      name: normalizeTrackingFieldName(checkboxMatch[2]),
      value: checkboxMatch[1].toLowerCase() === 'x' ? 'oui' : ''
    };
  }

  return null;
}

function normalizeTrackingFieldName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function findDailyTrackingEntryForDate(entries, isoDate) {
  var i;
  var latest = null;

  for (i = 0; i < entries.length; i += 1) {
    if (entries[i].date === isoDate) {
      return entries[i];
    }

    if (!latest || entries[i].date > latest.date) {
      latest = entries[i];
    }
  }

  return latest;
}

function assessDailyTrackingEntry(entry, requiredProperties, isoToday) {
  var requiredMap = requiredProperties.map(function(propertyName) {
    return {
      label: propertyName,
      key: normalizeTrackingFieldName(propertyName)
    };
  });
  var missingProperties = [];
  var filledProperties = [];
  var notes = [];

  if (!entry) {
    return {
      date: isoToday,
      exists: false,
      completed: false,
      title: 'Entree introuvable',
      missingProperties: requiredProperties.slice(),
      filledProperties: [],
      notes: ['Aucune entree datee n a ete detectee dans le fichier.']
    };
  }

  requiredMap.forEach(function(propertyItem) {
    var value = entry.fields[propertyItem.key];

    if (isTrackingValueFilled(value)) {
      filledProperties.push({
        name: propertyItem.label,
        value: value
      });
      return;
    }

    missingProperties.push(propertyItem.label);
  });

  if (entry.date !== isoToday) {
    notes.push('La derniere entree detectee est datee du ' + entry.date + ' au lieu de ' + isoToday + '.');
  }

  if (!Object.keys(entry.fields).length && entry.lines.length) {
    notes.push('Aucun champ au format cle: valeur n a ete reconnu dans cette entree.');
  }

  return {
    date: isoToday,
    entryDate: entry.date,
    exists: entry.date === isoToday,
    completed: entry.date === isoToday && missingProperties.length === 0,
    title: entry.title || 'Daily Tracking',
    missingProperties: missingProperties,
    filledProperties: filledProperties,
    notes: notes,
    entryLines: entry.lines.slice()
  };
}

function isTrackingValueFilled(value) {
  var normalized;

  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return !/^(non|no|false|ko|todo|n\/a|na|null|vide|none|-)$/.test(normalized);
}
