// API Base URL
const API_BASE = window.location.origin;

// WebSocket connection
let ws = null;
let wsReconnectAttempts = 0;
const WS_MAX_RECONNECT_ATTEMPTS = 5;
const WS_RECONNECT_DELAY = 3000;

// State
let projects = [];
let results = {};
let expandedProjects = new Set();
let expandedTests = new Set();

// Running project state: { projectId: { startTime, expectedTotal, passed, failed, skipped, completed } }
const runningProjectState = new Map();

// Elapsed time update interval
let elapsedTimeInterval = null;

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

// WebSocket setup
function connectWebSocket() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    wsReconnectAttempts = 0;
    updateConnectionStatus(true);
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateConnectionStatus(false);
    if (wsReconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
      wsReconnectAttempts++;
      console.log(`Reconnecting... attempt ${wsReconnectAttempts}`);
      setTimeout(connectWebSocket, WS_RECONNECT_DELAY);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.classList.toggle('connected', connected);
    statusEl.classList.toggle('disconnected', !connected);
    statusEl.title = connected ? 'Connected - Real-time updates active' : 'Disconnected - Reconnecting...';
  }
}

function handleWebSocketMessage(message) {
  const { event, data } = message;

  switch (event) {
    case 'tests:started':
      handleTestsStarted(data);
      break;

    case 'tests:progress':
      handleTestsProgress(data);
      break;

    case 'tests:completed':
      handleTestsCompleted(data);
      break;

    case 'tests:error':
      handleTestsError(data);
      break;

    case 'results:uploaded':
      handleResultsUploaded(data);
      break;

    default:
      console.log('Unknown WebSocket event:', event);
  }
}

function handleTestsStarted(data) {
  const { projectId, expectedTotal, startTime, grep } = data;

  // Initialize running state
  runningProjectState.set(projectId, {
    startTime: new Date(startTime),
    expectedTotal: expectedTotal || 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    completed: 0
  });

  showToast(`Tests started for ${projectId}${grep ? ` (${grep})` : ''} - ${expectedTotal} tests`, 'info');

  // Update card to show running state with zeroed counters
  updateCardForRunning(projectId);

  // Grey out results section for this project
  updateResultsRunningState(projectId, true);

  // Start elapsed time updates if not already running
  startElapsedTimeUpdates();
}

function handleTestsProgress(data) {
  const { projectId, passed, failed, skipped, completed, expectedTotal } = data;

  const state = runningProjectState.get(projectId);
  if (state) {
    state.passed = passed;
    state.failed = failed;
    state.skipped = skipped;
    state.completed = completed;
    state.expectedTotal = expectedTotal;

    // Update the card with new progress
    updateCardProgress(projectId, state);
  }
}

function handleTestsCompleted(data) {
  const { projectId, run } = data;

  // Remove from running state
  runningProjectState.delete(projectId);

  showToast(
    `Tests completed for ${projectId}: ${run.stats.passed}/${run.stats.total} passed`,
    run.stats.failed > 0 ? 'error' : 'success'
  );

  // Stop elapsed time updates if no more running projects
  if (runningProjectState.size === 0) {
    stopElapsedTimeUpdates();
  }

  // Un-grey results section
  updateResultsRunningState(projectId, false);

  // Refresh all results to get the final data
  loadResults();
}

function handleTestsError(data) {
  const { projectId, error } = data;

  runningProjectState.delete(projectId);
  showToast(`Test error for ${projectId}: ${error}`, 'error');

  if (runningProjectState.size === 0) {
    stopElapsedTimeUpdates();
  }

  updateResultsRunningState(projectId, false);
  renderSummaryCards();
}

function handleResultsUploaded(data) {
  const { projectId, run } = data;
  showToast(
    `Results uploaded for ${projectId}: ${run.stats.passed}/${run.stats.total} passed`,
    'success'
  );
  loadResults();
}

function updateCardForRunning(projectId) {
  const state = runningProjectState.get(projectId);
  if (!state) return;

  const card = document.querySelector(`[data-project-id="${projectId}"]`);
  if (!card) return;

  // Update status to "Running"
  const statusEl = card.querySelector('.summary-card-status');
  if (statusEl) {
    statusEl.className = 'summary-card-status status-running';
    statusEl.textContent = 'Running';
  }

  // Update stats to show 0 / expectedTotal
  updateCardProgress(projectId, state);

  // Update footer to show elapsed time
  const lastRunEl = card.querySelector('.last-run');
  if (lastRunEl) {
    lastRunEl.setAttribute('data-running', 'true');
    lastRunEl.textContent = 'Running: 0s';
  }

  // Update button
  const btn = card.querySelector('.run-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running...';
    btn.classList.add('running');
  }
}

function updateCardProgress(projectId, state) {
  const card = document.querySelector(`[data-project-id="${projectId}"]`);
  if (!card) return;

  // Update only the progress bar - stats stay at 0 until completion
  const progressBar = card.querySelector('.progress-bar');
  if (progressBar && state.expectedTotal > 0) {
    const percent = Math.round((state.completed / state.expectedTotal) * 100);
    progressBar.style.width = `${percent}%`;
  }
}

function updateElapsedTimes() {
  const now = new Date();

  for (const [projectId, state] of runningProjectState) {
    const card = document.querySelector(`[data-project-id="${projectId}"]`);
    if (!card) continue;

    const lastRunEl = card.querySelector('.last-run');
    if (lastRunEl && lastRunEl.getAttribute('data-running') === 'true') {
      // Ensure elapsed is never negative (handles clock skew between server/client)
      const elapsed = Math.max(0, Math.floor((now - state.startTime) / 1000));
      lastRunEl.textContent = `Running: ${formatElapsedTime(elapsed)}`;
    }
  }
}

function formatElapsedTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function startElapsedTimeUpdates() {
  if (!elapsedTimeInterval) {
    elapsedTimeInterval = setInterval(updateElapsedTimes, 1000);
  }
}

function stopElapsedTimeUpdates() {
  if (elapsedTimeInterval) {
    clearInterval(elapsedTimeInterval);
    elapsedTimeInterval = null;
  }
}

function updateResultsRunningState(projectId, isRunning) {
  const resultsEl = document.querySelector(`.project-results[data-results-project="${projectId}"]`);
  if (resultsEl) {
    resultsEl.classList.toggle('running-disabled', isRunning);
  }
}

// Initialize
async function init() {
  await loadProjects();
  await loadResults();
  setupEventListeners();
  connectWebSocket();
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

    const isRunning = runningProjectState.has(project.id);
    const runState = runningProjectState.get(project.id);

    let statusClass, statusText;
    if (isRunning) {
      statusClass = 'status-running';
      statusText = 'Running';
    } else {
      statusClass = data.status === 'failed' ? 'status-failed' :
                    data.status === 'passed' ? 'status-passed' : 'status-unknown';
      statusText = data.status || 'Unknown';
    }

    // When running: show all zeros. When complete: show actual results
    const passed = isRunning ? 0 : (data.passed || 0);
    const failed = isRunning ? 0 : (data.failed || 0);
    const skipped = isRunning ? 0 : (data.skipped || 0);
    const total = isRunning ? 0 : (data.total || 0);

    // Footer text
    let footerText;
    if (isRunning) {
      const elapsed = Math.max(0, Math.floor((new Date() - runState.startTime) / 1000));
      footerText = `Running: ${formatElapsedTime(elapsed)}`;
    } else {
      footerText = data.lastRun ? `Last run: ${formatDate(data.lastRun.timestamp)}` : 'Last run: Never';
    }

    // Calculate progress percentage for running state
    const progressPercent = isRunning && runState.expectedTotal > 0
      ? Math.round((runState.completed / runState.expectedTotal) * 100)
      : 0;

    card.innerHTML = `
      <div class="summary-card-header">
        <span class="summary-card-title">${project.name}</span>
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
      <div class="progress-bar-container ${isRunning ? 'active' : ''}">
        <div class="progress-bar" style="width: ${progressPercent}%"></div>
      </div>
      <div class="summary-card-footer">
        <span class="last-run" ${isRunning ? 'data-running="true"' : ''}>${footerText}</span>
        <button class="btn btn-sm btn-primary run-btn ${isRunning ? 'running' : ''}"
                onclick="runTests('${project.id}')" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? 'Running...' : 'Run Tests'}
        </button>
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
    const isRunning = runningProjectState.has(project.id);

    try {
      const res = await fetch(`${API_BASE}/api/results/${project.id}`);
      const data = await res.json();

      if (!data.lastRun) {
        const div = document.createElement('div');
        div.className = `project-results ${isRunning ? 'running-disabled' : ''}`;
        div.setAttribute('data-results-project', project.id);
        div.innerHTML = `
          <div class="project-header">
            <span class="project-name">${project.name}</span>
            <span class="project-summary">${isRunning ? 'Tests running...' : 'No tests run yet'}</span>
          </div>
        `;
        resultsContainer.appendChild(div);
        continue;
      }

      const tests = extractTests(data.lastRun.suites, selectedStatus);
      const isExpanded = expandedProjects.has(project.id) && !isRunning;

      const div = document.createElement('div');
      div.className = `project-results ${isRunning ? 'running-disabled' : ''}`;
      div.setAttribute('data-results-project', project.id);
      div.innerHTML = `
        <div class="project-header" onclick="${isRunning ? '' : `toggleProject('${project.id}')`}" style="${isRunning ? 'cursor: not-allowed;' : ''}">
          <span class="project-name">${project.name}</span>
          <div class="project-summary">
            ${isRunning ? '<span class="running-indicator">Tests running...</span>' : `
            <span style="color: var(--success)">✓ ${data.lastRun.stats.passed}</span>
            <span style="color: var(--error)">✗ ${data.lastRun.stats.failed}</span>
            <span style="color: var(--warning)">○ ${data.lastRun.stats.skipped}</span>
            `}
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
        <button class="btn btn-primary" onclick="runAllTests()">Run Tests</button>
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
    card.innerHTML = `
      <div class="history-card-header">
        <span class="history-project">${run.project}</span>
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
  // Don't allow expansion while running
  if (runningProjectState.has(projectId)) return;

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

// Run tests for a single project
async function runTests(projectId) {
  // Mark as pending in UI immediately
  const card = document.querySelector(`[data-project-id="${projectId}"]`);
  if (card) {
    const btn = card.querySelector('.run-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Starting...';
    }
  }

  try {
    const res = await fetch(`${API_BASE}/api/run/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Failed to start tests', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Run Tests';
      }
      return;
    }

    // WebSocket will handle tests:started with expectedTotal
  } catch (err) {
    showToast('Failed to start tests', 'error');
    if (card) {
      const btn = card.querySelector('.run-btn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Run Tests';
      }
    }
  }
}

// Run all tests
async function runAllTests() {
  try {
    const res = await fetch(`${API_BASE}/api/run-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    // Mark buttons as starting
    if (data.projects) {
      data.projects.forEach(projectId => {
        const card = document.querySelector(`[data-project-id="${projectId}"]`);
        if (card) {
          const btn = card.querySelector('.run-btn');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'Starting...';
          }
        }
      });
    }

    showToast('Running tests for all projects...', 'success');
  } catch (err) {
    showToast('Failed to start tests', 'error');
  }
}

// Setup event listeners
function setupEventListeners() {
  runAllBtn.addEventListener('click', runAllTests);
  refreshBtn.addEventListener('click', loadResults);
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

// Make functions available globally
window.runTests = runTests;
window.runAllTests = runAllTests;
window.toggleProject = toggleProject;
window.toggleTestDetails = toggleTestDetails;

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
