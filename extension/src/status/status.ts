// Status UI script

interface QueueStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  retries: number;
}

async function load() {
  try {
    const [queueResp, sessionResp, storageResp, errorsResp, coursesResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_QUEUE_STATS' }),
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_SESSION' }),
      chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' }),
      chrome.runtime.sendMessage({ type: 'GET_RECENT_ERRORS' }),
      chrome.runtime.sendMessage({ type: 'GET_STUDENT_INDEX' })
    ]);

    renderQueue(queueResp?.stats as QueueStats);
    renderSession(sessionResp?.session);
    renderStorage(storageResp?.stats);
    renderErrors(errorsResp?.errors || []);
    renderCourses(coursesResp?.index);
  } catch (e) {
    console.error('Status load failed', e);
  }
}

function renderQueue(stats?: QueueStats) {
  const el = document.getElementById('queue');
  if (!el || !stats) return;
  el.innerHTML = `
    <div class="grid">
      <div><b>Total</b><div>${stats.total}</div></div>
      <div><b>Pending</b><div>${stats.pending}</div></div>
      <div><b>Running</b><div>${stats.running}</div></div>
      <div><b>Completed</b><div>${stats.completed}</div></div>
      <div><b>Failed</b><div>${stats.failed}</div></div>
      <div><b>Retries</b><div>${stats.retries}</div></div>
    </div>
  `;
}

function renderSession(session?: any) {
  const el = document.getElementById('session');
  if (!el) return;
  if (!session) {
    el.textContent = 'No active session';
    return;
  }
  el.innerHTML = `
    <div><b>ID</b>: ${session.id}</div>
    <div><b>Status</b>: ${session.status}</div>
    <div><b>Started</b>: ${new Date(session.startTime).toLocaleString()}</div>
    <div><b>Progress</b>: ${session.tasksCompleted}/${session.tasksScheduled}, failed: ${session.tasksFailed}</div>
  `;
}

function renderStorage(stats?: any) {
  const el = document.getElementById('storage');
  if (!el || !stats) return;
  el.innerHTML = `
    <div class="grid">
      <div><b>HTML</b><div>${stats.htmlSnapshots}</div></div>
      <div><b>Structured</b><div>${stats.structured}</div></div>
      <div><b>Text</b><div>${stats.extractedText}</div></div>
      <div><b>Blobs</b><div>${stats.blobs}</div></div>
      <div><b>Total</b><div>${(stats.totalSize / (1024*1024)).toFixed(2)} MB</div></div>
    </div>
  `;
}

function renderErrors(errors: Array<any>) {
  const el = document.getElementById('errors');
  if (!el) return;
  if (!errors.length) {
    el.textContent = 'No recent errors';
    return;
    }
  el.innerHTML = errors.slice(0, 20).map(err => `
    <div class="err">
      <div class="row"><b>${err.type}</b> — ${new Date(err.when).toLocaleTimeString()}</div>
      <div class="row mono">${err.url}</div>
      <div class="row red">${err.error}</div>
    </div>
  `).join('');
}

function renderCourses(index?: any) {
  const el = document.getElementById('courses');
  if (!el) return;
  if (!index || !index.courses) {
    el.textContent = 'No courses discovered yet';
    return;
  }

  const courses: any[] = Object.values(index.courses);
  if (!courses.length) {
    el.textContent = 'No courses discovered yet';
    return;
  }

  el.innerHTML = courses.map(course => `
    <div class="course">
      <div class="row"><b>${course.code}</b> — ${course.name}</div>
      <div class="row mono">${course.url}</div>
      <div class="row">
        <button data-open="${course.url}/assignments">Assignments</button>
        <button data-open="${course.url}/discussion_topics">Discussions</button>
        <button data-open="${course.url}/quizzes">Quizzes</button>
        <button data-open="${course.url}/files">Files</button>
        <button data-open="${course.url}/wiki">Pages</button>
      </div>
    </div>
  `).join('');

  // Attach open handlers
  el.querySelectorAll('button[data-open]')
    .forEach(btn => btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const url = target.getAttribute('data-open');
      if (url) chrome.tabs.create({ url });
    }));
}

async function manualRescan() {
  const btn = document.getElementById('rescanBtn') as HTMLButtonElement;
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'MANUAL_RESCAN' });
    await load();
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('rescanBtn')?.addEventListener('click', manualRescan);
  load();
});


