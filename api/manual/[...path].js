const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Checklist directory resolution
function getChecklistsDir() {
  if (fs.existsSync('/data/websites/.platform/test-checklists')) {
    return '/data/websites/.platform/test-checklists';
  }
  const bundledPath = path.join(process.cwd(), 'data/checklists');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }
  return path.join(__dirname, '../../data/checklists');
}
const CHECKLISTS_DIR = process.env.CHECKLISTS_DIR || getChecklistsDir();

const PROJECT_MAPPING = {
  'kanban': 'kanban.md',
  'crossfit-generator': 'wodforge.md',
  'wodforge': 'wodforge.md',
  'rental': 'sorring-udlejning.md',
  'sorring-udlejning': 'sorring-udlejning.md',
  'sorring3d': 'sorring3d.md',
  'sorring-3d': 'sorring3d.md',
  'grablist': 'grablist.md',
  'shopping-list': 'grablist.md',
  'calify': 'calify.md',
  'ical-adjuster': 'calify.md',
  'playwright': 'playwright.md',
  'test-dashboard': 'playwright.md'
};

const SKIP_SECTIONS = [
  'API Endpoint Tests', 'Playwright Test Outline', 'Test Data Requirements',
  'Known Issues', 'Skip Conditions', 'Quick Reference', 'Smoke Test Commands',
  'Test Categories', 'Running Playwright Tests', 'Verification Plan'
];

function parseChecklist(content) {
  const lines = content.split('\n');
  const categories = [];
  const items = [];
  let currentCategory = null;
  let currentSubcategory = null;
  let itemIndex = 0;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      currentCategory = h2Match[1].trim();
      currentSubcategory = null;
      if (SKIP_SECTIONS.some(s => currentCategory.toLowerCase().includes(s.toLowerCase()))) {
        currentCategory = null;
        continue;
      }
      if (!categories.includes(currentCategory)) {
        categories.push(currentCategory);
      }
      continue;
    }

    const h3Match = line.match(/^### (.+)$/);
    if (h3Match && currentCategory) {
      currentSubcategory = h3Match[1].trim();
      continue;
    }

    const itemMatch = line.match(/^- \[ \] (.+)$/);
    if (itemMatch && currentCategory) {
      const title = itemMatch[1].trim();
      const fullCategory = currentSubcategory
        ? currentCategory + ' > ' + currentSubcategory
        : currentCategory;
      items.push({
        index: itemIndex++,
        category: fullCategory,
        title: title,
        status: 'pending'
      });
    }
  }

  return { categories, items };
}

function listChecklists() {
  const checklists = [];
  try {
    if (!fs.existsSync(CHECKLISTS_DIR)) return [];
    const files = fs.readdirSync(CHECKLISTS_DIR);
    for (const file of files) {
      if (file.endsWith('.md') && file !== 'README.md') {
        const filePath = path.join(CHECKLISTS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseChecklist(content);
        const nameMatch = content.match(/^# (.+?)( - E2E Test Checklist)?$/m);
        const name = nameMatch ? nameMatch[1].trim() : file.replace('.md', '');
        const projectId = Object.entries(PROJECT_MAPPING)
          .find(([_, filename]) => filename === file)?.[0] || file.replace('.md', '');
        checklists.push({
          projectId,
          projectName: name,
          filename: file,
          itemCount: parsed.items.length,
          categoryCount: parsed.categories.length
        });
      }
    }
  } catch (err) {
    console.error('Error listing checklists:', err);
  }
  return checklists;
}

function getChecklist(projectId) {
  const filename = PROJECT_MAPPING[projectId];
  if (filename === null) return null;
  if (!filename) {
    const directPath = path.join(CHECKLISTS_DIR, projectId + '.md');
    if (fs.existsSync(directPath)) {
      return parseChecklist(fs.readFileSync(directPath, 'utf-8'));
    }
    return null;
  }
  const filePath = path.join(CHECKLISTS_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return parseChecklist(fs.readFileSync(filePath, 'utf-8'));
}

function generateSessionId() {
  return 'session-' + crypto.randomBytes(8).toString('hex');
}

function isValidProjectId(projectId) {
  if (!projectId || typeof projectId !== 'string') return false;
  return /^[a-zA-Z0-9_-]+$/.test(projectId) && projectId.length <= 100;
}

const KANBAN_API = 'https://kanban.exe.pm/api/board';

// Main handler
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle path from Vercel - comes as req.query['...path'] (can be string or array)
  let pathParts = req.query['...path'] || req.query.path || [];
  if (typeof pathParts === 'string') {
    pathParts = pathParts.split('/').filter(p => p);
  }
  if (!Array.isArray(pathParts)) {
    pathParts = [];
  }
  const route = '/' + pathParts.join('/');

  // Route: GET /checklists
  if (route === '/checklists' && req.method === 'GET') {
    try {
      return res.json(listChecklists());
    } catch (err) {
      console.error('Error listing checklists:', err);
      return res.status(500).json({ error: 'Failed to list checklists' });
    }
  }

  // Route: GET /checklists/:projectId
  if (route.startsWith('/checklists/') && req.method === 'GET') {
    const projectId = pathParts[1];
    if (!isValidProjectId(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    try {
      const checklist = getChecklist(projectId);
      if (!checklist) {
        return res.status(404).json({ error: 'Checklist not found for project' });
      }
      return res.json(checklist);
    } catch (err) {
      console.error('Error getting checklist:', err);
      return res.status(500).json({ error: 'Failed to get checklist' });
    }
  }

  // Route: GET/POST /sessions
  if (route === '/sessions') {
    if (req.method === 'GET') {
      const { projectId, status, limit = 20 } = req.query;
      try {
        let query = 'SELECT session_id, project_id, status, started_at, completed_at, total_items, passed_items, failed_items, skipped_items, notes FROM manual_test_sessions';
        const params = [];
        const conditions = [];

        if (projectId) {
          if (!isValidProjectId(projectId)) {
            return res.status(400).json({ error: 'Invalid project ID' });
          }
          conditions.push('project_id = $' + (params.length + 1));
          params.push(projectId);
        }
        if (status) {
          conditions.push('status = $' + (params.length + 1));
          params.push(status);
        }
        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1);
        params.push(parseInt(limit, 10));

        const result = await pool.query(query, params);
        return res.json(result.rows.map(row => ({
          sessionId: row.session_id,
          projectId: row.project_id,
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          totalItems: row.total_items,
          passedItems: row.passed_items,
          failedItems: row.failed_items,
          skippedItems: row.skipped_items,
          notes: row.notes
        })));
      } catch (err) {
        console.error('Error listing sessions:', err);
        return res.status(500).json({ error: 'Failed to list sessions' });
      }
    }

    if (req.method === 'POST') {
      const { projectId, createdBy, notes } = req.body;
      if (!projectId || !isValidProjectId(projectId)) {
        return res.status(400).json({ error: 'Invalid or missing project ID' });
      }
      try {
        const projectChecklist = getChecklist(projectId);
        if (!projectChecklist) {
          return res.status(404).json({ error: 'Checklist not found for project' });
        }
        const sessionId = generateSessionId();
        const totalItems = projectChecklist.items.length;

        await pool.query(
          "INSERT INTO manual_test_sessions (session_id, project_id, status, total_items, created_by, notes) VALUES ($1, $2, 'in_progress', $3, $4, $5)",
          [sessionId, projectId, totalItems, createdBy || null, notes || null]
        );

        for (const item of projectChecklist.items) {
          await pool.query(
            "INSERT INTO manual_test_items (session_id, item_index, category, title, status, is_custom) VALUES ($1, $2, $3, $4, 'pending', false)",
            [sessionId, item.index, item.category, item.title]
          );
        }

        return res.status(201).json({
          sessionId,
          projectId,
          status: 'in_progress',
          startedAt: new Date().toISOString(),
          totalItems,
          passedItems: 0,
          failedItems: 0,
          skippedItems: 0,
          items: projectChecklist.items
        });
      } catch (err) {
        console.error('Error creating session:', err);
        return res.status(500).json({ error: 'Failed to create session' });
      }
    }
  }

  // Route: GET/PATCH /sessions/:sessionId
  if (pathParts[0] === 'sessions' && pathParts.length === 2) {
    const sessionId = pathParts[1];

    if (req.method === 'GET') {
      try {
        const sessionResult = await pool.query(
          'SELECT session_id, project_id, status, started_at, completed_at, total_items, passed_items, failed_items, skipped_items, created_by, notes FROM manual_test_sessions WHERE session_id = $1',
          [sessionId]
        );
        if (sessionResult.rows.length === 0) {
          return res.status(404).json({ error: 'Session not found' });
        }
        const session = sessionResult.rows[0];
        const itemsResult = await pool.query(
          'SELECT id, item_index, category, title, status, error_description, is_custom, tested_at, kanban_card_id FROM manual_test_items WHERE session_id = $1 ORDER BY item_index',
          [sessionId]
        );
        return res.json({
          sessionId: session.session_id,
          projectId: session.project_id,
          status: session.status,
          startedAt: session.started_at,
          completedAt: session.completed_at,
          totalItems: session.total_items,
          passedItems: session.passed_items,
          failedItems: session.failed_items,
          skippedItems: session.skipped_items,
          createdBy: session.created_by,
          notes: session.notes,
          items: itemsResult.rows.map(item => ({
            id: item.id,
            index: item.item_index,
            category: item.category,
            title: item.title,
            status: item.status,
            errorDescription: item.error_description,
            isCustom: item.is_custom,
            testedAt: item.tested_at,
            kanbanCardId: item.kanban_card_id
          }))
        });
      } catch (err) {
        console.error('Error getting session:', err);
        return res.status(500).json({ error: 'Failed to get session' });
      }
    }

    if (req.method === 'PATCH') {
      const { status, notes } = req.body;
      const validStatuses = ['in_progress', 'completed', 'cancelled'];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      try {
        const updates = [];
        const params = [];
        if (status) {
          params.push(status);
          updates.push('status = $' + params.length);
          if (status === 'completed' || status === 'cancelled') {
            updates.push('completed_at = NOW()');
          }
        }
        if (notes !== undefined) {
          params.push(notes);
          updates.push('notes = $' + params.length);
        }
        if (updates.length === 0) {
          return res.status(400).json({ error: 'No updates provided' });
        }
        params.push(sessionId);
        const query = 'UPDATE manual_test_sessions SET ' + updates.join(', ') + ' WHERE session_id = $' + params.length + ' RETURNING session_id, project_id, status, started_at, completed_at, total_items, passed_items, failed_items, skipped_items, notes';
        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Session not found' });
        }
        const session = result.rows[0];
        return res.json({
          sessionId: session.session_id,
          projectId: session.project_id,
          status: session.status,
          startedAt: session.started_at,
          completedAt: session.completed_at,
          totalItems: session.total_items,
          passedItems: session.passed_items,
          failedItems: session.failed_items,
          skippedItems: session.skipped_items,
          notes: session.notes
        });
      } catch (err) {
        console.error('Error updating session:', err);
        return res.status(500).json({ error: 'Failed to update session' });
      }
    }
  }

  // Route: POST /sessions/:sessionId/items
  if (pathParts[0] === 'sessions' && pathParts[2] === 'items' && req.method === 'POST') {
    const sessionId = pathParts[1];
    const { category, title } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title is required' });
    }
    try {
      const sessionCheck = await pool.query('SELECT 1 FROM manual_test_sessions WHERE session_id = $1', [sessionId]);
      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const maxResult = await pool.query('SELECT COALESCE(MAX(item_index), -1) as max_index FROM manual_test_items WHERE session_id = $1', [sessionId]);
      const newIndex = maxResult.rows[0].max_index + 1;
      const result = await pool.query(
        "INSERT INTO manual_test_items (session_id, item_index, category, title, status, is_custom) VALUES ($1, $2, $3, $4, 'pending', true) RETURNING id, item_index, category, title, status, is_custom",
        [sessionId, newIndex, category || 'Custom', title]
      );
      await pool.query('UPDATE manual_test_sessions SET total_items = total_items + 1 WHERE session_id = $1', [sessionId]);
      const item = result.rows[0];
      return res.status(201).json({
        id: item.id,
        index: item.item_index,
        category: item.category,
        title: item.title,
        status: item.status,
        isCustom: item.is_custom
      });
    } catch (err) {
      console.error('Error adding item:', err);
      return res.status(500).json({ error: 'Failed to add item' });
    }
  }

  // Route: POST /sessions/:sessionId/report
  if (pathParts[0] === 'sessions' && pathParts[2] === 'report' && req.method === 'POST') {
    const sessionId = pathParts[1];
    try {
      const sessionResult = await pool.query(
        'SELECT session_id, project_id, started_at FROM manual_test_sessions WHERE session_id = $1',
        [sessionId]
      );
      if (sessionResult.rows.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const session = sessionResult.rows[0];
      const failedResult = await pool.query(
        "SELECT id, category, title, error_description FROM manual_test_items WHERE session_id = $1 AND status = 'failed' ORDER BY category, item_index",
        [sessionId]
      );
      if (failedResult.rows.length === 0) {
        return res.json({ message: 'No failed items', cards: [] });
      }
      const groupedFailures = {};
      for (const item of failedResult.rows) {
        const cat = item.category || 'Uncategorized';
        if (!groupedFailures[cat]) groupedFailures[cat] = [];
        groupedFailures[cat].push(item);
      }
      const categoryTotals = {};
      const totalsResult = await pool.query(
        "SELECT category, COUNT(*) as total, SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed FROM manual_test_items WHERE session_id = $1 GROUP BY category",
        [sessionId]
      );
      for (const row of totalsResult.rows) {
        categoryTotals[row.category || 'Uncategorized'] = {
          total: parseInt(row.total, 10),
          passed: parseInt(row.passed, 10),
          failed: parseInt(row.failed, 10)
        };
      }
      const createdCards = [];
      for (const [category, items] of Object.entries(groupedFailures)) {
        const failCount = items.length;
        const totals = categoryTotals[category] || { total: failCount, passed: 0, failed: failCount };
        let description = '## Manual Test Failures\n\n';
        description += '**Project:** ' + session.project_id + '\n';
        description += '**Category:** ' + category + '\n';
        description += '**Session:** ' + session.session_id + '\n';
        description += '**Tested:** ' + new Date(session.started_at).toISOString() + '\n\n';
        description += '---\n\n### Failed Tests\n\n';
        for (const item of items) {
          description += '#### X ' + item.title + '\n';
          description += '**Error:** ' + item.error_description + '\n\n';
        }
        description += '---\n\n### Session Summary\n';
        description += '- Total in category: ' + totals.total + '\n';
        description += '- Passed: ' + totals.passed + '\n';
        description += '- Failed: ' + totals.failed + '\n';
        const cardTitle = 'BUG: ' + category + ' - ' + failCount + ' test failure' + (failCount > 1 ? 's' : '');
        try {
          const response = await fetch(KANBAN_API + '/cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: cardTitle,
              description: description,
              projectId: session.project_id,
              columnId: 'backlog',
              priority: 'high',
              type: 'bug'
            })
          });
          if (response.ok) {
            const cardData = await response.json();
            createdCards.push({
              category,
              failCount,
              cardId: cardData.id,
              cardUrl: 'https://kanban.exe.pm/card/' + cardData.id
            });
            const itemIds = items.map(i => i.id);
            await pool.query('UPDATE manual_test_items SET kanban_card_id = $1 WHERE id = ANY($2::int[])', [cardData.id, itemIds]);
          } else {
            const errorText = await response.text();
            console.error('Failed to create Kanban card:', errorText);
            createdCards.push({ category, failCount, error: 'Failed to create card' });
          }
        } catch (fetchErr) {
          console.error('Error calling Kanban API:', fetchErr);
          createdCards.push({ category, failCount, error: fetchErr.message });
        }
      }
      return res.json({
        message: 'Created ' + createdCards.filter(c => c.cardId).length + ' bug cards',
        cards: createdCards
      });
    } catch (err) {
      console.error('Error generating report:', err);
      return res.status(500).json({ error: 'Failed to generate report' });
    }
  }

  // Route: PATCH/DELETE /items/:itemId
  if (pathParts[0] === 'items' && pathParts.length === 2) {
    const itemId = pathParts[1];

    if (req.method === 'PATCH') {
      const { status, errorDescription } = req.body;
      const validStatuses = ['pending', 'passed', 'failed', 'skipped'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      if (status === 'failed' && !errorDescription) {
        return res.status(400).json({ error: 'Error description required for failed items' });
      }
      try {
        const currentResult = await pool.query(
          'SELECT session_id, status as old_status FROM manual_test_items WHERE id = $1',
          [itemId]
        );
        if (currentResult.rows.length === 0) {
          return res.status(404).json({ error: 'Item not found' });
        }
        const { session_id: sessionId, old_status: oldStatus } = currentResult.rows[0];
        const result = await pool.query(
          'UPDATE manual_test_items SET status = $1, error_description = $2, tested_at = NOW() WHERE id = $3 RETURNING id, item_index, category, title, status, error_description, tested_at',
          [status, status === 'failed' ? errorDescription : null, itemId]
        );
        const item = result.rows[0];
        const counterUpdates = [];
        if (oldStatus === 'passed') counterUpdates.push('passed_items = passed_items - 1');
        if (oldStatus === 'failed') counterUpdates.push('failed_items = failed_items - 1');
        if (oldStatus === 'skipped') counterUpdates.push('skipped_items = skipped_items - 1');
        if (status === 'passed') counterUpdates.push('passed_items = passed_items + 1');
        if (status === 'failed') counterUpdates.push('failed_items = failed_items + 1');
        if (status === 'skipped') counterUpdates.push('skipped_items = skipped_items + 1');
        if (counterUpdates.length > 0) {
          await pool.query('UPDATE manual_test_sessions SET ' + counterUpdates.join(', ') + ' WHERE session_id = $1', [sessionId]);
        }
        return res.json({
          id: item.id,
          index: item.item_index,
          category: item.category,
          title: item.title,
          status: item.status,
          errorDescription: item.error_description,
          testedAt: item.tested_at
        });
      } catch (err) {
        console.error('Error updating item:', err);
        return res.status(500).json({ error: 'Failed to update item' });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const itemResult = await pool.query(
          'SELECT session_id, status, is_custom FROM manual_test_items WHERE id = $1',
          [itemId]
        );
        if (itemResult.rows.length === 0) {
          return res.status(404).json({ error: 'Item not found' });
        }
        const { session_id: sessionId, status, is_custom: isCustom } = itemResult.rows[0];
        if (isCustom) {
          await pool.query('DELETE FROM manual_test_items WHERE id = $1', [itemId]);
          const counterUpdates = ['total_items = total_items - 1'];
          if (status === 'passed') counterUpdates.push('passed_items = passed_items - 1');
          if (status === 'failed') counterUpdates.push('failed_items = failed_items - 1');
          if (status === 'skipped') counterUpdates.push('skipped_items = skipped_items - 1');
          await pool.query('UPDATE manual_test_sessions SET ' + counterUpdates.join(', ') + ' WHERE session_id = $1', [sessionId]);
          return res.json({ deleted: true });
        } else {
          await pool.query("UPDATE manual_test_items SET status = 'skipped', tested_at = NOW() WHERE id = $1", [itemId]);
          const counterUpdates = ['skipped_items = skipped_items + 1'];
          if (status === 'passed') counterUpdates.push('passed_items = passed_items - 1');
          if (status === 'failed') counterUpdates.push('failed_items = failed_items - 1');
          if (status !== 'skipped') {
            await pool.query('UPDATE manual_test_sessions SET ' + counterUpdates.join(', ') + ' WHERE session_id = $1', [sessionId]);
          }
          return res.json({ skipped: true });
        }
      } catch (err) {
        console.error('Error deleting item:', err);
        return res.status(500).json({ error: 'Failed to delete item' });
      }
    }
  }

  return res.status(404).json({ error: 'Not found' });
};
