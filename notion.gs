function getNotionTasksTodayAndOverdue(config) {
  requireConfig(config, ['notionApiKey', 'notionTasksDatabaseId']);

  var today = new Date();
  var isoToday = isoDateParis(today);
  var payload = {
    filter: {
      and: [
        {
          property: config.notionTasksDueDateProperty,
          date: { on_or_before: isoToday }
        },
        {
          or: [
            {
              property: config.notionTasksStatusProperty,
              status: { equals: 'Not started' }
            },
            {
              property: config.notionTasksStatusProperty,
              status: { equals: 'In progress' }
            },
            {
              property: config.notionTasksStatusProperty,
              status: { equals: 'Testing' }
            }
          ]
        }
      ]
    },
    sorts: [
      { property: config.notionTasksDueDateProperty, direction: 'ascending' }
    ],
    page_size: 100
  };

  var data = queryNotionDatabase(config.notionApiKey, config.notionTasksDatabaseId, payload);
  var todayList = [];
  var overdueList = [];

  (data.results || []).forEach(function(page) {
    var task = mapNotionTaskPage(page, config, isoToday);

    if (!task) {
      return;
    }

    if (task.age_days === 0) {
      todayList.push(task);
      return;
    }

    if (task.age_days >= 1) {
      overdueList.push(task);
    }
  });

  todayList.sort(function(a, b) {
    return getPriorityRank(a.priority) - getPriorityRank(b.priority);
  });

  overdueList.sort(function(a, b) {
    if (a.age_days !== b.age_days) {
      return a.age_days - b.age_days;
    }

    return getPriorityRank(a.priority) - getPriorityRank(b.priority);
  });

  return {
    today: todayList,
    overdue: overdueList
  };
}

function getDailyTrackingStatus(config, date) {
  requireConfig(config, ['notionApiKey', 'notionDailyTrackingDatabaseId']);

  var isoToday = isoDateParis(date || new Date());
  var requiredProperties = getDailyTrackingRequiredProperties(config);
  var payload = {
    filter: {
      property: config.notionDailyTrackingDateProperty,
      date: { equals: isoToday }
    },
    page_size: 10
  };
  var data = queryNotionDatabase(config.notionApiKey, config.notionDailyTrackingDatabaseId, payload);
  var page = data.results && data.results.length ? data.results[0] : null;

  if (!page) {
    return {
      date: isoToday,
      exists: false,
      completed: false,
      title: 'Entree introuvable',
      missingProperties: requiredProperties.slice()
    };
  }

  var properties = page.properties || {};
  var missingProperties = requiredProperties.filter(function(propertyName) {
    return isNotionPropertyEmpty(properties[propertyName]);
  });

  return {
    date: isoToday,
    exists: true,
    completed: missingProperties.length === 0,
    title: notionPropertyToPlainText(properties[config.notionDailyTrackingTitleProperty]) || 'Daily Tracking',
    url: page.url,
    missingProperties: missingProperties
  };
}

function queryNotionDatabase(notionApiKey, databaseId, payload) {
  var url = 'https://api.notion.com/v1/databases/' + databaseId + '/query';

  return fetchJson(url, {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + notionApiKey,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function mapNotionTaskPage(page, config, isoToday) {
  var props = page.properties || {};
  var title = notionPropertyToPlainText(props[config.notionTasksTitleProperty]);
  var status = notionPropertyToStatus(props[config.notionTasksStatusProperty]);
  var priority = notionPropertyToSelect(props[config.notionTasksPriorityProperty]);
  var due = notionPropertyToDate(props[config.notionTasksDueDateProperty]);

  if (!title || !due) {
    return null;
  }

  return {
    title: title,
    status: status,
    priority: priority,
    due: due,
    age_days: daysBetweenParis(due, isoToday)
  };
}

function notionPropertyToPlainText(property) {
  var richText;

  if (!property) {
    return '';
  }

  if (property.title && property.title.length) {
    return property.title.map(function(item) {
      return item.plain_text;
    }).join('');
  }

  richText = property.rich_text || property.richText;
  if (richText && richText.length) {
    return richText.map(function(item) {
      return item.plain_text;
    }).join('');
  }

  if (property.formula && property.formula.string) {
    return property.formula.string;
  }

  return '';
}

function notionPropertyToStatus(property) {
  return property && property.status ? property.status.name : '';
}

function notionPropertyToSelect(property) {
  return property && property.select ? property.select.name : '';
}

function notionPropertyToDate(property) {
  return property && property.date ? property.date.start : '';
}

function notionPropertyToBoolean(property) {
  if (!property) {
    return false;
  }

  if (typeof property.checkbox === 'boolean') {
    return property.checkbox;
  }

  if (property.status && property.status.name) {
    return /done|complete|completed|filled/i.test(property.status.name);
  }

  if (property.select && property.select.name) {
    return /done|complete|completed|filled/i.test(property.select.name);
  }

  if (property.formula) {
    if (typeof property.formula.boolean === 'boolean') {
      return property.formula.boolean;
    }

    if (property.formula.string) {
      return /done|complete|completed|filled/i.test(property.formula.string);
    }
  }

  return false;
}

function getDailyTrackingRequiredProperties(config) {
  var raw = config.notionDailyTrackingRequiredProperties;

  if (!raw) {
    return getDefaultDailyTrackingRequiredProperties();
  }

  return raw.split(',').map(function(item) {
    return item.trim();
  }).filter(function(item) {
    return item;
  });
}

function isNotionPropertyEmpty(property) {
  if (!property) {
    return true;
  }

  switch (property.type) {
    case 'title':
      return !(property.title && property.title.length);
    case 'rich_text':
      return !(property.rich_text && property.rich_text.length);
    case 'number':
      return property.number === null || typeof property.number === 'undefined';
    case 'select':
      return !property.select;
    case 'multi_select':
      return !(property.multi_select && property.multi_select.length);
    case 'status':
      return !property.status;
    case 'date':
      return !(property.date && property.date.start);
    case 'checkbox':
      return property.checkbox !== true;
    case 'url':
      return !property.url;
    case 'email':
      return !property.email;
    case 'phone_number':
      return !property.phone_number;
    case 'people':
      return !(property.people && property.people.length);
    case 'relation':
      return !(property.relation && property.relation.length);
    case 'files':
      return !(property.files && property.files.length);
    case 'formula':
      return isNotionFormulaEmpty(property.formula);
    default:
      return !notionPropertyToPlainText(property);
  }
}

function isNotionFormulaEmpty(formula) {
  if (!formula) {
    return true;
  }

  if (formula.type === 'string') {
    return !formula.string;
  }

  if (formula.type === 'number') {
    return formula.number === null || typeof formula.number === 'undefined';
  }

  if (formula.type === 'boolean') {
    return formula.boolean !== true;
  }

  if (formula.type === 'date') {
    return !(formula.date && formula.date.start);
  }

  return true;
}
