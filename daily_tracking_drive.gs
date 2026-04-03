function getDailyTrackingStatusFromDrive(config, date) {
  requireConfig(config, ['googleDailyTrackingFolderId']);

  var targetDate = date || new Date();
  var isoToday = isoDateParis(targetDate);
  var requiredProperties = getDailyTrackingRequiredProperties(config);
  var folderId = extractGoogleDriveId(config.googleDailyTrackingFolderId);
  var folder = null;
  var file = null;
  var content;
  var parsedFile;
  var entry;
  var assessment;

  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (error) {
    folder = null;
  }

  if (folder) {
    file = findBestDailyTrackingFile(folder, isoToday);
  }

  if (!file) {
    return {
      date: isoToday,
      exists: false,
      completed: false,
      title: 'Fichier introuvable',
      sourceType: 'google-drive',
      sourceName: 'Daily Tracking folder',
      missingProperties: requiredProperties.slice(),
      notes: ['Aucun fichier Daily Tracking exploitable n a ete trouve dans le dossier configure.']
    };
  }

  content = readDriveFileContent(file);
  parsedFile = parseDailyTrackingFile(content, file.getName());
  entry = parsedFile.entry;
  assessment = assessDailyTrackingEntry(entry, requiredProperties, isoToday);

  assessment.sourceType = 'google-drive';
  assessment.sourceName = file.getName();
  assessment.fileId = file.getId();
  assessment.url = file.getUrl();
  assessment.rawContent = content;
  assessment.fileDate = extractDateFromFilename(file.getName());
  assessment.availableEntryDates = [entry && entry.date ? entry.date : ''];

  return assessment;
}

function findBestDailyTrackingFile(folder, isoToday) {
  var candidates = [];

  collectDailyTrackingFiles(folder, candidates);

  if (!candidates.length) {
    return null;
  }

  candidates.sort(function(left, right) {
    return scoreDailyTrackingFile(right, isoToday) - scoreDailyTrackingFile(left, isoToday);
  });

  return candidates[0];
}

function collectDailyTrackingFiles(folder, results) {
  var files = folder.getFiles();
  var subfolders = folder.getFolders();
  var file;

  while (files.hasNext()) {
    file = files.next();

    if (isDailyTrackingCandidate(file)) {
      results.push(file);
    }
  }

  while (subfolders.hasNext()) {
    collectDailyTrackingFiles(subfolders.next(), results);
  }
}

function isDailyTrackingCandidate(file) {
  var name = String(file.getName() || '').toLowerCase();
  var mimeType = file.getMimeType();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    return true;
  }

  return /\.md$/i.test(name) || /\.markdown$/i.test(name) || /\.base$/i.test(name);
}

function scoreDailyTrackingFile(file, isoToday) {
  var name = String(file.getName() || '');
  var score = 0;
  var updatedAt = file.getLastUpdated ? file.getLastUpdated().getTime() : 0;

  if (name.indexOf(isoToday) >= 0) {
    score += 1000000;
  }

  if (/daily/i.test(name)) {
    score += 5000;
  }

  if (/tracking/i.test(name)) {
    score += 5000;
  }

  if (/\.md$/i.test(name)) {
    score += 1000;
  }

  score += Math.floor(updatedAt / 1000);
  return score;
}

function readDriveFileContent(file) {
  var mimeType = file.getMimeType();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(file.getId()).getBody().getText();
  }

  return file.getBlob().getDataAsString();
}

function parseDailyTrackingFile(content, fileName) {
  var normalized = String(content || '').replace(/\r\n/g, '\n');
  var lines = normalized.split('\n');
  var fields = {};
  var entryLines = [];
  var detectedDates = [];
  var fieldDate = '';
  var metadataDate = '';
  var i;
  var line;
  var dateMatch;
  var fieldMatch;

  for (i = 0; i < lines.length; i += 1) {
    line = lines[i].trim();

    if (!line) {
      continue;
    }

    if (line === '---' || line === '- - -' || line === '- - - -') {
      continue;
    }

    entryLines.push(line);
    fieldMatch = parseTrackingFieldLine(line);

    if (fieldMatch) {
      fields[fieldMatch.name] = fieldMatch.value;

      if (fieldMatch.name === 'date') {
        fieldDate = extractDateFromLine(fieldMatch.value) || fieldDate;
      }

      if (fieldMatch.name === 'metadata date') {
        metadataDate = extractDateFromLine(fieldMatch.value) || metadataDate;
      }
    }

    dateMatch = extractDateFromLine(line);
    if (dateMatch) {
      detectedDates.push(dateMatch);
    }
  }

  return {
    entry: {
      date: metadataDate || extractDateFromFilename(fileName) || fieldDate || detectedDates[0] || '',
      title: fileName || 'Daily Tracking',
      fields: fields,
      lines: entryLines
    }
  };
}

function extractDateFromLine(line) {
  var match = String(line || '').match(/(?:^|[^0-9])(\d{4}-\d{2}-\d{2}|\d{8}|\d{2}\/\d{2}\/\d{4})(?:[^0-9]|$)/);
  var normalized;
  var parts;

  if (!match) {
    return '';
  }

  normalized = match[1];
  if (/^\d{8}$/.test(normalized)) {
    return normalized.slice(0, 4) + '-' + normalized.slice(4, 6) + '-' + normalized.slice(6, 8);
  }

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
    .replace(/^\d+\.\s*/, '')
    .replace(/^==\s*/, '')
    .replace(/\s*==$/, '');
  var match = cleaned.match(/^(.+?)\s*(?::|=)\s*(.*)$/);
  var checkboxMatch;

  if (!match) {
    match = cleaned.match(/^(.+?)\s-\s(.*)$/);
  }

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
    .replace(/^==\s*/, '')
    .replace(/\s*==$/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractDateFromFilename(fileName) {
  return extractDateFromLine(String(fileName || ''));
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
    var value = getTrackingFieldValue(entry.fields, propertyItem.label);

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

function mapTrackingFieldAliases(fieldName) {
  var normalized = normalizeTrackingFieldName(fieldName);

  if (normalized === 'wake up') {
    return ['wake up', 'wakeup', 'wake'];
  }

  if (normalized === 'go to bed') {
    return ['go to bed', 'bedtime', 'sleep'];
  }

  if (normalized === 'job') {
    return ['job', 'work'];
  }

  if (normalized === 'digital work') {
    return ['digital work', 'digital'];
  }

  if (normalized === 'sport') {
    return ['sport', 'exercise'];
  }

  if (normalized === 'ambiente') {
    return ['ambiente', 'mood'];
  }

  return [normalized];
}

function getTrackingFieldValue(fields, propertyName) {
  var aliases = mapTrackingFieldAliases(propertyName);
  var i;

  for (i = 0; i < aliases.length; i += 1) {
    if (typeof fields[aliases[i]] !== 'undefined') {
      return fields[aliases[i]];
    }
  }

  return '';
}

function isExplicitMidnightValue(value) {
  var normalized = String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();

  return normalized === '0000' || normalized === '00:00' || normalized === '0h00';
}

function isTrackingValueFilled(value) {
  var normalized;

  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  if (isExplicitMidnightValue(value)) {
    return true;
  }

  normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return !/^(non|no|false|ko|todo|n\/a|na|null|vide|none|-)$/.test(normalized);
}
