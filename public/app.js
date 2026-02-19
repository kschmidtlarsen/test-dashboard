// API Base URL
const API_BASE = window.location.origin;

// GitHub repo name mapping (for repos where name differs from project ID)
const GITHUB_REPO_MAP = {
  'crossfit-generator': 'crossfit_generator'
};

// Get GitHub repo name for a project
function getGitHubRepo(projectId) {
  return GITHUB_REPO_MAP[projectId] || projectId;
}

// Polling configuration
const POLL_INTERVAL = 30000; // 30 seconds
let pollInterval = null;
let lastUpdateTimestamp = null;

// State
let projects = [];
let results = {};
let expandedProjects = new Set();
let expandedTests = new Set();

// DOM Elements
const summaryCards = document.getElementById('summaryCards');
const resultsContainer = document.getElementById('resultsContainer');
const historyContainer = document.getElementById('historyContainer');
const projectFilter = document.getElementById('projectFilter');
const statusFilter = document.getElementById('statusFilter');
const runAllBtn = document.getElementById('runAllBtn');
const refreshBtn = document.getElementById('refreshBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

// Polling for updates
async function checkForUpdates() {
  try {
    const url = lastUpdateTimestamp
      ? `${API_BASE}/api/poll?since=${encodeURIComponent(lastUpdateTimestamp)}`
      : `${API_BASE}/api/poll`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.hasUpdates || !lastUpdateTimestamp) {
      lastUpdateTimestamp = data.latest;
      await loadResults();
      updateConnectionStatus(true);
    }
  } catch (err) {
    console.error('Polling error:', err);
    updateConnectionStatus(false);
  }
}

function startPolling() {
  if (!pollInterval) {
    pollInterval = setInterval(checkForUpdates, POLL_INTERVAL);
    updateConnectionStatus(true);
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.classList.toggle('connected', connected);
    statusEl.classList.toggle('disconnected', !connected);
    statusEl.title = connected ? 'Auto-refresh active (30s)' : 'Connection issue - click Refresh';
  }
}

// Initialize
async function init() {
  await loadProjects();
  await loadResults();
  setupEventListeners();
  startPolling();
}

// Load projects
async function loadProjects() {
  try {
    const res = await fetch(`${API_BASE}/api/projects`);
    projects = await res.json();

    // Populate project filter
    projectFilter.innerHTML = '<option value="all">All Projects</option>';
    projects.forEach(p => {
      projectFilter.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
  } catch (err) {
    showToast('Failed to load projects', 'error');
  }
}

// Load all results
async function loadResults() {
  try {
    const res = await fetch(`${API_BASE}/api/results`);
    results = await res.json();
    renderSummaryCards();
    renderResults();
    renderHistory();
  } catch (err) {
    showToast('Failed to load results', 'error');
  }
}

// Render summary cards
function renderSummaryCards() {
  summaryCards.innerHTML = '';

  for (const project of projects) {
    const data = results[project.id] || {};
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.setAttribute('data-project-id', project.id);

    const statusClass = data.status === 'failed' ? 'status-failed' :
                        data.status === 'passed' ? 'status-passed' : 'status-unknown';
    const statusText = data.status || 'Unknown';

    const passed = data.passed || 0;
    const failed = data.failed || 0;
    const skipped = data.skipped || 0;
    const total = data.total || 0;
    const testScope = data.testScope || 'full';

    const footerText = data.lastRun ? `Last run: ${formatDate(data.lastRun.timestamp)}` : 'Last run: Never';
    const scopeBadge = testScope === 'smoke' ?
      '<span class="scope-badge smoke">Smoke</span>' :
      '<span class="scope-badge full">Full</span>';

    card.innerHTML = `
      <div class="summary-card-header">
        <div class="summary-card-title-row">
          <span class="summary-card-title">${project.name}</span>
          <div class="badge-row">
            <span class="test-type-badge automated">⚡ E2E</span>
            ${data.lastRun ? scopeBadge : ''}
          </div>
        </div>
        <span class="summary-card-status ${statusClass}">
          ${statusText}
        </span>
      </div>
      <div class="summary-card-stats">
        <div class="stat">
          <div class="stat-value passed">${passed}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat">
          <div class="stat-value failed">${failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat">
          <div class="stat-value skipped">${skipped}</div>
          <div class="stat-label">Skipped</div>
        </div>
        <div class="stat">
          <div class="stat-value total">${total}</div>
          <div class="stat-label">Total</div>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="last-run">${footerText}</span>
        <a href="https://github.com/kschmidtlarsen/${getGitHubRepo(project.id)}/actions/workflows/e2e-manual.yml"
           target="_blank"
           class="btn btn-sm btn-primary run-btn"
           title="Run tests via GitHub Actions">
          Run Tests ↗
        </a>
      </div>
    `;

    summaryCards.appendChild(card);
  }
}

// Render detailed results
async function renderResults() {
  resultsContainer.innerHTML = '';

  const selectedProject = projectFilter.value;
  const selectedStatus = statusFilter.value;

  const projectsToShow = selectedProject === 'all' ?
    projects : projects.filter(p => p.id === selectedProject);

  for (const project of projectsToShow) {
    try {
      const res = await fetch(`${API_BASE}/api/results/${project.id}`);
      const data = await res.json();

      if (!data.lastRun) {
        const div = document.createElement('div');
        div.className = 'project-results';
        div.setAttribute('data-results-project', project.id);
        div.innerHTML = `
          <div class="project-header">
            <span class="project-name">${project.name}</span>
            <span class="project-summary">No tests run yet</span>
          </div>
        `;
        resultsContainer.appendChild(div);
        continue;
      }

      const tests = extractTests(data.lastRun.suites, selectedStatus);
      const isExpanded = expandedProjects.has(project.id);

      const div = document.createElement('div');
      div.className = 'project-results';
      div.setAttribute('data-results-project', project.id);
      div.innerHTML = `
        <div class="project-header" onclick="toggleProject('${project.id}')">
          <span class="project-name">${project.name}</span>
          <div class="project-summary">
            <span style="color: var(--success)">✓ ${data.lastRun.stats.passed}</span>
            <span style="color: var(--error)">✗ ${data.lastRun.stats.failed}</span>
            <span style="color: var(--warning)">○ ${data.lastRun.stats.skipped}</span>
          </div>
        </div>
        <div class="test-list ${isExpanded ? 'expanded' : ''}" id="tests-${project.id}">
          ${tests.map((t, idx) => {
            const testId = `${project.id}-test-${idx}`;
            const isTestExpanded = expandedTests.has(testId);
            return `
              <div class="test-item-wrapper">
                <div class="test-item" onclick="toggleTestDetails('${testId}')">
                  <div class="test-name">
                    <span class="test-status-icon ${t.status}">${getStatusIcon(t.status)}</span>
                    <span>${t.title}</span>
                  </div>
                  <div class="test-meta">
                    <span class="test-duration">${t.duration}ms</span>
                    ${t.description ? '<span class="test-info-icon" title="Click for details">ℹ</span>' : ''}
                  </div>
                </div>
                <div class="test-details ${isTestExpanded ? 'expanded' : ''}" id="details-${testId}">
                  ${t.description ? `
                    <div class="test-description">
                      <strong>What this test does:</strong>
                      <p>${t.description}</p>
                    </div>
                  ` : ''}
                  ${t.file ? `<div class="test-file"><strong>File:</strong> ${t.file}:${t.line}</div>` : ''}
                  ${t.errors && t.errors.length > 0 ? `
                    <div class="test-errors">
                      <strong>Errors:</strong>
                      <pre>${t.errors.map(e => e.message || e).join('\n')}</pre>
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      resultsContainer.appendChild(div);
    } catch (err) {
      console.error(`Failed to load results for ${project.id}:`, err);
    }
  }

  if (resultsContainer.innerHTML === '') {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p>No test results available</p>
        <p>Run tests via GitHub Actions to see results here.</p>
      </div>
    `;
  }
}

// Extract tests from suites
function extractTests(suites, statusFilter) {
  const tests = [];

  function traverse(suites, prefix = '') {
    for (const suite of suites || []) {
      const suiteName = prefix ? `${prefix} > ${suite.title}` : suite.title;

      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const result = test.results?.[0];
          const status = result?.status || 'unknown';
          const normalizedStatus = status === 'expected' ? 'passed' :
                                   status === 'unexpected' ? 'failed' : status;

          if (statusFilter === 'all' || normalizedStatus === statusFilter) {
            const descAnnotation = test.annotations?.find(a => a.type === 'description');
            const description = descAnnotation?.description || null;

            tests.push({
              title: `${suiteName} > ${spec.title}`,
              status: normalizedStatus,
              duration: result?.duration || 0,
              description: description,
              file: spec.file || null,
              line: spec.line || null,
              errors: result?.errors || []
            });
          }
        }
      }

      traverse(suite.suites, suiteName);
    }
  }

  traverse(suites);
  return tests;
}

// Toggle test details
function toggleTestDetails(testId) {
  if (expandedTests.has(testId)) {
    expandedTests.delete(testId);
  } else {
    expandedTests.add(testId);
  }

  const details = document.getElementById(`details-${testId}`);
  if (details) {
    details.classList.toggle('expanded');
  }
}

// Render history
async function renderHistory() {
  historyContainer.innerHTML = '';

  const allHistory = [];

  for (const project of projects) {
    try {
      const res = await fetch(`${API_BASE}/api/history/${project.id}`);
      const runs = await res.json();

      for (const run of runs.slice(0, 5)) {
        allHistory.push({
          project: project.name,
          projectId: project.id,
          ...run
        });
      }
    } catch (err) {
      console.error(`Failed to load history for ${project.id}:`, err);
    }
  }

  allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  for (const run of allHistory.slice(0, 10)) {
    const card = document.createElement('div');
    card.className = 'history-card';
    const scopeBadge = run.testScope === 'smoke' ?
      '<span class="scope-badge smoke">Smoke</span>' :
      '<span class="scope-badge full">Full</span>';
    card.innerHTML = `
      <div class="history-card-header">
        <div class="history-title-row">
          <span class="history-project">${run.project}</span>
          ${scopeBadge}
        </div>
        <span class="history-time">${formatDate(run.timestamp)}</span>
      </div>
      <div class="history-stats">
        <span style="color: var(--success)">✓ ${run.stats.passed}</span>
        <span style="color: var(--error)">✗ ${run.stats.failed}</span>
        <span style="color: var(--warning)">○ ${run.stats.skipped}</span>
      </div>
    `;
    historyContainer.appendChild(card);
  }

  if (allHistory.length === 0) {
    historyContainer.innerHTML = `
      <div class="empty-state">
        <p>No test history available</p>
      </div>
    `;
  }
}

// Toggle project expansion
function toggleProject(projectId) {
  if (expandedProjects.has(projectId)) {
    expandedProjects.delete(projectId);
  } else {
    expandedProjects.add(projectId);
  }

  const testList = document.getElementById(`tests-${projectId}`);
  if (testList) {
    testList.classList.toggle('expanded');
  }
}

// Open GitHub Actions to run all tests
function runAllTests() {
  window.open('https://github.com/kschmidtlarsen?tab=repositories', '_blank');
  showToast('Opening GitHub - select a repo and run the E2E workflow', 'info');
}

// Setup event listeners
function setupEventListeners() {
  runAllBtn.addEventListener('click', runAllTests);
  refreshBtn.addEventListener('click', async () => {
    showToast('Refreshing...', 'info');
    await loadResults();
    showToast('Results refreshed', 'success');
  });
  projectFilter.addEventListener('change', renderResults);
  statusFilter.addEventListener('change', renderResults);
}

// Utility functions
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStatusIcon(status) {
  switch (status) {
    case 'passed': return '✓';
    case 'failed': return '✗';
    case 'skipped': return '○';
    default: return '?';
  }
}

function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// ============================================
// Manual Testing Module
// ============================================

// Manual test state
let manualChecklists = [];
let currentSession = null;
let pendingFailItem = null;

// Manual test DOM elements (initialized in setupManualTestListeners)
let manualTestSection = null;
let manualStartView = null;
let manualSessionView = null;
let manualProjectSelect = null;
let startManualTestBtn = null;
let recentSessionsList = null;

// Tab switching
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide sections
      const resultsSection = document.querySelector('.summary-section');
      const detailsSection = document.querySelector('.details-section');
      const historySection = document.querySelector('.history-section');
      const manualSection = document.getElementById('manualTestSection');

      if (targetTab === 'results') {
        if (resultsSection) resultsSection.classList.remove('hidden');
        if (detailsSection) detailsSection.classList.remove('hidden');
        if (historySection) historySection.classList.remove('hidden');
        if (manualSection) manualSection.classList.add('hidden');
      } else if (targetTab === 'manual') {
        if (resultsSection) resultsSection.classList.add('hidden');
        if (detailsSection) detailsSection.classList.add('hidden');
        if (historySection) historySection.classList.add('hidden');
        if (manualSection) manualSection.classList.remove('hidden');
        loadManualTestData();
      }
    });
  });
}

// Load checklists and recent sessions
async function loadManualTestData() {
  try {
    // Load available checklists
    const checklistRes = await fetch(API_BASE + '/api/manual/checklists');
    manualChecklists = await checklistRes.json();

    // Populate project selector
    if (manualProjectSelect) {
      manualProjectSelect.innerHTML = '<option value="">-- Choose a project --</option>';
      manualChecklists.forEach(c => {
        manualProjectSelect.innerHTML += '<option value="' + c.projectId + '">' + c.projectName + ' (' + c.itemCount + ' items)</option>';
      });
    }

    // Load recent sessions
    const sessionsRes = await fetch(API_BASE + '/api/manual/sessions');
    const sessions = await sessionsRes.json();
    renderRecentSessions(sessions);
  } catch (err) {
    console.error('Failed to load manual test data:', err);
    showToast('Failed to load manual test data', 'error');
  }
}

// Render recent sessions list
function renderRecentSessions(sessions) {
  if (!recentSessionsList) return;

  if (!sessions || sessions.length === 0) {
    recentSessionsList.innerHTML = '<p class="empty-message">No recent sessions</p>';
    return;
  }

  recentSessionsList.innerHTML = sessions.map(function(s) {
    var statusClass = s.status === 'completed' ? 'completed' : 'in-progress';
    var progress = s.totalItems > 0 ? Math.round(((s.passedItems + s.failedItems + s.skippedItems) / s.totalItems) * 100) : 0;

    return '<div class="session-card ' + statusClass + '" onclick="resumeSession(\'' + s.sessionId + '\')">' +
      '<div class="session-card-header">' +
        '<div class="session-card-title-row">' +
          '<span class="session-project">' + s.projectId + '</span>' +
          '<span class="test-type-badge manual">👤 Manual</span>' +
        '</div>' +
        '<span class="session-status">' + s.status + '</span>' +
      '</div>' +
      '<div class="session-card-stats">' +
        '<span class="stat-passed">' + s.passedItems + '</span> / ' +
        '<span class="stat-failed">' + s.failedItems + '</span> / ' +
        '<span class="stat-skipped">' + s.skippedItems + '</span>' +
      '</div>' +
      '<div class="session-card-progress">' +
        '<div class="progress-bar-bg">' +
          '<div class="progress-bar-fill" style="width: ' + progress + '%"></div>' +
        '</div>' +
      '</div>' +
      '<div class="session-card-time">' + formatDate(s.startedAt) + '</div>' +
    '</div>';
  }).join('');
}

// Start new manual test session
async function startManualTest() {
  var projectId = manualProjectSelect.value;
  if (!projectId) return;

  try {
    var res = await fetch(API_BASE + '/api/manual/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projectId })
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to start session');
    }

    var session = await res.json();
    showSessionView(session);
    showToast('Session started', 'success');
  } catch (err) {
    console.error('Failed to start session:', err);
    showToast(err.message, 'error');
  }
}

// Resume existing session
async function resumeSession(sessionId) {
  try {
    var res = await fetch(API_BASE + '/api/manual/sessions/' + sessionId);
    if (!res.ok) throw new Error('Session not found');

    var session = await res.json();
    showSessionView(session);
  } catch (err) {
    console.error('Failed to resume session:', err);
    showToast('Failed to resume session', 'error');
  }
}

// Show session view with checklist
function showSessionView(session) {
  currentSession = session;

  if (manualStartView) manualStartView.classList.add('hidden');
  if (manualSessionView) manualSessionView.classList.remove('hidden');

  // Update header
  var projectNameEl = document.getElementById('sessionProjectName');
  var sessionIdEl = document.getElementById('sessionId');
  if (projectNameEl) projectNameEl.textContent = session.projectId;
  if (sessionIdEl) sessionIdEl.textContent = 'Session: ' + session.sessionId;

  updateSessionProgress();
  renderChecklist();
}

// Update progress display
function updateSessionProgress() {
  if (!currentSession) return;

  var passed = currentSession.passedItems || 0;
  var failed = currentSession.failedItems || 0;
  var skipped = currentSession.skippedItems || 0;
  var total = currentSession.totalItems || 0;
  var pending = total - passed - failed - skipped;

  var passedEl = document.getElementById('sessionPassed');
  var failedEl = document.getElementById('sessionFailed');
  var skippedEl = document.getElementById('sessionSkipped');
  var pendingEl = document.getElementById('sessionPending');
  var progressBar = document.getElementById('sessionProgressBar');

  if (passedEl) passedEl.textContent = passed;
  if (failedEl) failedEl.textContent = failed;
  if (skippedEl) skippedEl.textContent = skipped;
  if (pendingEl) pendingEl.textContent = pending;

  if (progressBar && total > 0) {
    var passedPct = (passed / total) * 100;
    var failedPct = (failed / total) * 100;
    var skippedPct = (skipped / total) * 100;
    progressBar.style.background = 'linear-gradient(to right, var(--success) 0%, var(--success) ' + passedPct + '%, var(--error) ' + passedPct + '%, var(--error) ' + (passedPct + failedPct) + '%, var(--warning) ' + (passedPct + failedPct) + '%, var(--warning) ' + (passedPct + failedPct + skippedPct) + '%, var(--bg-tertiary) ' + (passedPct + failedPct + skippedPct) + '%)';
  }
}

// Render checklist items grouped by category
function renderChecklist() {
  var container = document.getElementById('checklistContainer');
  if (!container || !currentSession || !currentSession.items) return;

  // Group by category
  var categories = {};
  currentSession.items.forEach(function(item) {
    var cat = item.category || 'Uncategorized';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  });

  var html = '';
  Object.keys(categories).forEach(function(catName) {
    var items = categories[catName];
    html += '<div class="checklist-category">';
    html += '<h3 class="category-title">' + catName + '</h3>';
    html += '<div class="category-items">';

    items.forEach(function(item) {
      var statusClass = 'status-' + item.status;
      var isCustom = item.isCustom ? ' is-custom' : '';

      html += '<div class="checklist-item ' + statusClass + isCustom + '" data-item-id="' + item.id + '">';
      html += '<div class="item-content">';
      html += '<span class="item-title">' + item.title + '</span>';
      if (item.isCustom) html += '<span class="custom-badge">Custom</span>';
      html += '</div>';

      if (item.status === 'failed' && item.errorDescription) {
        html += '<div class="item-error">' + item.errorDescription + '</div>';
      }

      if (item.status === 'pending') {
        html += '<div class="item-actions">';
        html += '<button class="btn btn-sm btn-success" onclick="markItem(' + item.id + ', \'passed\')">Pass</button>';
        html += '<button class="btn btn-sm btn-error" onclick="openFailModal(' + item.id + ', \'' + escapeHtml(item.title) + '\')">Fail</button>';
        html += '<button class="btn btn-sm btn-secondary" onclick="markItem(' + item.id + ', \'skipped\')">Skip</button>';
        html += '</div>';
      }

      html += '</div>';
    });

    html += '</div></div>';
  });

  container.innerHTML = html;
}

function getCheckboxIcon(status) {
  switch (status) {
    case 'passed': return '✓';
    case 'failed': return '✗';
    case 'skipped': return '○';
    default: return '☐';
  }
}

function escapeHtml(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Mark item as passed or skipped
async function markItem(itemId, status) {
  try {
    var body = { status: status };

    var res = await fetch(API_BASE + '/api/manual/items/' + itemId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to update item');
    }

    // Update local state
    var item = currentSession.items.find(function(i) { return i.id === itemId; });
    if (item) {
      var oldStatus = item.status;
      item.status = status;

      // Update counters
      if (oldStatus === 'passed') currentSession.passedItems--;
      if (oldStatus === 'failed') currentSession.failedItems--;
      if (oldStatus === 'skipped') currentSession.skippedItems--;

      if (status === 'passed') currentSession.passedItems++;
      if (status === 'failed') currentSession.failedItems++;
      if (status === 'skipped') currentSession.skippedItems++;
    }

    updateSessionProgress();
    renderChecklist();
  } catch (err) {
    console.error('Failed to mark item:', err);
    showToast(err.message, 'error');
  }
}

// Open fail modal for error description
function openFailModal(itemId, itemTitle) {
  pendingFailItem = itemId;
  var modal = document.getElementById('errorDescModal');
  var titleEl = document.getElementById('failingItemTitle');
  var descInput = document.getElementById('errorDescription');

  if (titleEl) titleEl.textContent = itemTitle;
  if (descInput) descInput.value = '';
  if (modal) modal.classList.remove('hidden');
}

function closeErrorDescModal() {
  pendingFailItem = null;
  var modal = document.getElementById('errorDescModal');
  if (modal) modal.classList.add('hidden');
}

// Confirm fail with description
async function confirmFail() {
  if (!pendingFailItem) return;

  var descInput = document.getElementById('errorDescription');
  var errorDescription = descInput ? descInput.value.trim() : '';

  if (!errorDescription) {
    showToast('Please describe the error', 'error');
    return;
  }

  try {
    var res = await fetch(API_BASE + '/api/manual/items/' + pendingFailItem, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', errorDescription: errorDescription })
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to update item');
    }

    // Update local state
    var item = currentSession.items.find(function(i) { return i.id === pendingFailItem; });
    if (item) {
      var oldStatus = item.status;
      item.status = 'failed';
      item.errorDescription = errorDescription;

      if (oldStatus === 'passed') currentSession.passedItems--;
      if (oldStatus === 'skipped') currentSession.skippedItems--;
      currentSession.failedItems++;
    }

    closeErrorDescModal();
    updateSessionProgress();
    renderChecklist();
  } catch (err) {
    console.error('Failed to mark item as failed:', err);
    showToast(err.message, 'error');
  }
}

// Add custom item modal
function openAddItemModal() {
  var modal = document.getElementById('addItemModal');
  var catSelect = document.getElementById('customItemCategorySelect');
  var catInput = document.getElementById('customItemCategoryNew');
  var titleInput = document.getElementById('customItemTitle');

  // Get existing categories from current session
  if (catSelect && currentSession && currentSession.items) {
    var categories = [];
    currentSession.items.forEach(function(item) {
      var cat = item.category || 'Uncategorized';
      if (categories.indexOf(cat) === -1) categories.push(cat);
    });

    catSelect.innerHTML = '<option value="">-- Select category --</option>';
    categories.forEach(function(cat) {
      catSelect.innerHTML += '<option value="' + escapeHtml(cat) + '">' + cat + '</option>';
    });
    catSelect.innerHTML += '<option value="__new__">+ Create new category</option>';
    catSelect.value = '';
  }

  var catGroup = document.getElementById('newCategoryGroup');
  if (catGroup) catGroup.classList.add('hidden');
  if (catInput) {
    catInput.value = '';
    catInput.classList.add('hidden');
  }
  if (titleInput) titleInput.value = '';
  if (modal) modal.classList.remove('hidden');
}

// Handle category select change
function onCategorySelectChange() {
  var catSelect = document.getElementById('customItemCategorySelect');
  var catGroup = document.getElementById('newCategoryGroup');
  var catInput = document.getElementById('customItemCategoryNew');

  if (catSelect && catGroup && catInput) {
    if (catSelect.value === '__new__') {
      catGroup.classList.remove('hidden');
      catInput.classList.remove('hidden');
      catInput.focus();
    } else {
      catGroup.classList.add('hidden');
      catInput.classList.add('hidden');
    }
  }
}

function closeAddItemModal() {
  var modal = document.getElementById('addItemModal');
  if (modal) modal.classList.add('hidden');
}

async function confirmAddItem() {
  var catSelect = document.getElementById('customItemCategorySelect');
  var catInput = document.getElementById('customItemCategoryNew');
  var titleInput = document.getElementById('customItemTitle');

  var category;
  if (catSelect && catSelect.value === '__new__') {
    category = catInput ? catInput.value.trim() : 'Custom';
  } else {
    category = catSelect ? catSelect.value : 'Custom';
  }
  if (!category) category = 'Custom';

  var title = titleInput ? titleInput.value.trim() : '';

  if (!title) {
    showToast('Please enter a test description', 'error');
    return;
  }

  try {
    var res = await fetch(API_BASE + '/api/manual/sessions/' + currentSession.sessionId + '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category || 'Custom', title: title })
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to add item');
    }

    var newItem = await res.json();
    currentSession.items.push(newItem);
    currentSession.totalItems++;

    closeAddItemModal();
    updateSessionProgress();
    renderChecklist();
    showToast('Item added', 'success');
  } catch (err) {
    console.error('Failed to add item:', err);
    showToast(err.message, 'error');
  }
}

// Cancel session
async function cancelSession() {
  if (!currentSession) return;

  if (!confirm('Are you sure you want to cancel this session? Progress will be saved.')) {
    return;
  }

  try {
    var res = await fetch(API_BASE + '/api/manual/sessions/' + currentSession.sessionId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to cancel session');
    }

    showToast('Session cancelled', 'info');

    // Return to start view
    currentSession = null;
    if (manualSessionView) manualSessionView.classList.add('hidden');
    if (manualStartView) manualStartView.classList.remove('hidden');
    loadManualTestData();
  } catch (err) {
    console.error('Failed to cancel session:', err);
    showToast(err.message, 'error');
  }
}

// Complete session
async function completeSession() {
  if (!currentSession) return;

  var pending = currentSession.totalItems - currentSession.passedItems - currentSession.failedItems - currentSession.skippedItems;

  if (pending > 0) {
    showToast('Complete all items before finishing', 'error');
    return;
  }

  // Check for failed items
  if (currentSession.failedItems > 0) {
    showBugCardPreview();
    return;
  }

  await finalizeSession();
}

// Show bug card preview
function showBugCardPreview() {
  var failedItems = currentSession.items.filter(function(i) { return i.status === 'failed'; });

  // Group by category
  var categories = {};
  failedItems.forEach(function(item) {
    var cat = item.category || 'Uncategorized';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(item);
  });

  var previewText = document.getElementById('bugCardPreviewText');
  var previewList = document.getElementById('bugCardPreviewList');

  if (previewText) {
    previewText.textContent = Object.keys(categories).length + ' bug card(s) will be created:';
  }

  if (previewList) {
    var html = '';
    Object.keys(categories).forEach(function(catName) {
      var count = categories[catName].length;
      html += '<div class="bug-card-preview-item">';
      html += '<strong>' + catName + '</strong> - ' + count + ' failure' + (count > 1 ? 's' : '');
      html += '</div>';
    });
    previewList.innerHTML = html;
  }

  var modal = document.getElementById('bugCardModal');
  if (modal) modal.classList.remove('hidden');
}

function closeBugCardModal() {
  var modal = document.getElementById('bugCardModal');
  if (modal) modal.classList.add('hidden');
}

// Create bug cards and finalize
async function createBugCardsAndFinalize() {
  try {
    var res = await fetch(API_BASE + '/api/manual/sessions/' + currentSession.sessionId + '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to create bug cards');
    }

    var result = await res.json();
    showToast(result.message, 'success');

    closeBugCardModal();
    await finalizeSession();
  } catch (err) {
    console.error('Failed to create bug cards:', err);
    showToast(err.message, 'error');
  }
}

async function finalizeSession() {
  try {
    var res = await fetch(API_BASE + '/api/manual/sessions/' + currentSession.sessionId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' })
    });

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Failed to complete session');
    }

    showToast('Session completed!', 'success');

    // Return to start view
    currentSession = null;
    if (manualSessionView) manualSessionView.classList.add('hidden');
    if (manualStartView) manualStartView.classList.remove('hidden');
    loadManualTestData();
  } catch (err) {
    console.error('Failed to finalize session:', err);
    showToast(err.message, 'error');
  }
}

// Setup manual test event listeners
function setupManualTestListeners() {
  manualTestSection = document.getElementById('manualTestSection');
  manualStartView = document.getElementById('manualStartView');
  manualSessionView = document.getElementById('manualSessionView');
  manualProjectSelect = document.getElementById('manualProjectSelect');
  startManualTestBtn = document.getElementById('startManualTestBtn');
  recentSessionsList = document.getElementById('recentSessionsList');

  // Enable start button when project selected
  if (manualProjectSelect) {
    manualProjectSelect.addEventListener('change', function() {
      if (startManualTestBtn) {
        startManualTestBtn.disabled = !manualProjectSelect.value;
      }
    });
  }

  // Start test button
  if (startManualTestBtn) {
    startManualTestBtn.addEventListener('click', startManualTest);
  }

  // Add custom item button
  var addCustomItemBtn = document.getElementById('addCustomItemBtn');
  if (addCustomItemBtn) {
    addCustomItemBtn.addEventListener('click', openAddItemModal);
  }

  // Complete session button
  var completeSessionBtn = document.getElementById('completeSessionBtn');
  if (completeSessionBtn) {
    completeSessionBtn.addEventListener('click', completeSession);
  }

  // Cancel session button
  var cancelSessionBtn = document.getElementById('cancelSessionBtn');
  if (cancelSessionBtn) {
    cancelSessionBtn.addEventListener('click', cancelSession);
  }

  // Category select change handler
  var catSelect = document.getElementById('customItemCategorySelect');
  if (catSelect) {
    catSelect.addEventListener('change', onCategorySelectChange);
  }

  // Confirm fail button
  var confirmFailBtn = document.getElementById('confirmFailBtn');
  if (confirmFailBtn) {
    confirmFailBtn.addEventListener('click', confirmFail);
  }

  // Confirm add item button
  var confirmAddItemBtn = document.getElementById('confirmAddItemBtn');
  if (confirmAddItemBtn) {
    confirmAddItemBtn.addEventListener('click', confirmAddItem);
  }

  // Create bug cards button
  var createBugCardsBtn = document.getElementById('createBugCardsBtn');
  if (createBugCardsBtn) {
    createBugCardsBtn.addEventListener('click', createBugCardsAndFinalize);
  }

  // Setup tabs
  setupTabs();
}

// Make functions available globally
window.toggleProject = toggleProject;
window.toggleTestDetails = toggleTestDetails;
window.markItem = markItem;
window.openFailModal = openFailModal;
window.closeErrorDescModal = closeErrorDescModal;
window.closeBugCardModal = closeBugCardModal;
window.closeAddItemModal = closeAddItemModal;
window.resumeSession = resumeSession;

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
  init();
  setupManualTestListeners();
});
