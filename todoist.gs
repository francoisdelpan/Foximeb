function getDailyBriefTaskPack(config) {
  return getTodoistTasksTodayAndOverdue(config);
}

function getTodoistTasksTodayAndOverdue(config) {
  requireConfig(config, ['todoistApiToken']);

  var isoToday = isoDateParis(new Date());
  var tasks = fetchAllTodoistActiveTasks(config.todoistApiToken);
  var todayList = [];
  var overdueList = [];

  tasks.forEach(function(task) {
    var mappedTask = mapTodoistTask(task, isoToday);

    if (!mappedTask) {
      return;
    }

    if (mappedTask.age_days === 0) {
      todayList.push(mappedTask);
      return;
    }

    if (mappedTask.age_days >= 1) {
      overdueList.push(mappedTask);
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

function fetchAllTodoistActiveTasks(todoistApiToken) {
  var allTasks = [];
  var cursor = null;
  var page;

  do {
    page = fetchTodoistActiveTasksPage(todoistApiToken, cursor);
    allTasks = allTasks.concat(page.results || []);
    cursor = page.next_cursor || null;
  } while (cursor);

  return allTasks;
}

function fetchTodoistActiveTasksPage(todoistApiToken, cursor) {
  var url = 'https://api.todoist.com/api/v1/tasks?limit=200';

  if (cursor) {
    url += '&cursor=' + encodeURIComponent(cursor);
  }

  return fetchJson(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + todoistApiToken
    },
    muteHttpExceptions: true
  });
}

function mapTodoistTask(task, isoToday) {
  var due = task && task.due ? task.due.date : '';
  var title = task ? task.content : '';

  if (!title || !due || due > isoToday) {
    return null;
  }

  return {
    title: title,
    status: '',
    priority: mapTodoistPriority(task.priority),
    due: due,
    age_days: daysBetweenParis(due, isoToday),
    source: 'todoist',
    url: task.url || ''
  };
}

function mapTodoistPriority(priority) {
  if (priority === 4) {
    return 'P1';
  }

  if (priority === 3) {
    return 'P2';
  }

  if (priority === 2) {
    return 'P3';
  }

  return '';
}
