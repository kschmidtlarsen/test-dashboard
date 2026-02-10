const { test, expect } = require('@playwright/test');

test.describe('Test Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the dashboard with correct title', async ({ page }) => {
    await expect(page).toHaveTitle('E2E Test Dashboard');
    await expect(page.locator('header h1')).toHaveText('E2E Test Dashboard');
  });

  test('should display header action buttons', async ({ page }) => {
    await expect(page.locator('#runAllBtn')).toBeVisible();
    await expect(page.locator('#refreshBtn')).toBeVisible();
  });

  test('should display overview section', async ({ page }) => {
    await expect(page.locator('section.summary-section h2')).toHaveText('Overview');
    await expect(page.locator('#summaryCards')).toBeVisible();
  });

  test('should display test results section with filters', async ({ page }) => {
    await expect(page.locator('section.details-section h2')).toHaveText('Test Results');
    await expect(page.locator('#projectFilter')).toBeVisible();
    await expect(page.locator('#statusFilter')).toBeVisible();
  });

  test('should display run history section', async ({ page }) => {
    await expect(page.locator('section.history-section h2')).toHaveText('Run History');
    await expect(page.locator('#historyContainer')).toBeVisible();
  });

  test('project filter should have "All Projects" option', async ({ page }) => {
    const option = page.locator('#projectFilter option[value="all"]');
    await expect(option).toHaveText('All Projects');
  });

  test('status filter should have all status options', async ({ page }) => {
    await expect(page.locator('#statusFilter option[value="all"]')).toHaveText('All Status');
    await expect(page.locator('#statusFilter option[value="passed"]')).toHaveText('Passed');
    await expect(page.locator('#statusFilter option[value="failed"]')).toHaveText('Failed');
    await expect(page.locator('#statusFilter option[value="skipped"]')).toHaveText('Skipped');
  });
});

test.describe('Project Accordion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for results to load
    await page.waitForSelector('#resultsContainer', { timeout: 5000 });
  });

  test('should expand project when header is clicked', async ({ page }) => {
    // Check if there are any project results
    const projectHeaders = page.locator('.project-header');
    const count = await projectHeaders.count();

    if (count > 0) {
      // Get the first project's test list
      const firstHeader = projectHeaders.first();
      const projectId = await firstHeader.evaluate(el => {
        const onclick = el.getAttribute('onclick');
        return onclick ? onclick.match(/toggleProject\('([^']+)'\)/)?.[1] : null;
      });

      if (projectId) {
        const testList = page.locator(`#tests-${projectId}`);

        // Initially should not have expanded class
        await expect(testList).not.toHaveClass(/expanded/);

        // Click to expand
        await firstHeader.click();

        // Should now have expanded class
        await expect(testList).toHaveClass(/expanded/);

        // Click again to collapse
        await firstHeader.click();

        // Should not have expanded class anymore
        await expect(testList).not.toHaveClass(/expanded/);
      }
    }
  });

  test('expanded accordion should show all tests without overflow', async ({ page }) => {
    const projectHeaders = page.locator('.project-header');
    const count = await projectHeaders.count();

    if (count > 0) {
      const firstHeader = projectHeaders.first();

      // Click to expand
      await firstHeader.click();

      // Wait for expansion
      await page.waitForTimeout(500);

      // Get the test list element
      const testList = page.locator('.test-list.expanded').first();
      const isVisible = await testList.isVisible();

      if (isVisible) {
        // Check that the test list has no max-height constraint or is set to 'none'
        const maxHeight = await testList.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.maxHeight;
        });

        // max-height should be 'none' (no limit) after our fix
        expect(maxHeight).toBe('none');

        // Check that overflow is visible
        const overflow = await testList.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.overflow;
        });

        expect(overflow).toBe('visible');
      }
    }
  });

  test('all test items should be fully visible when accordion is expanded', async ({ page }) => {
    const projectHeaders = page.locator('.project-header');
    const count = await projectHeaders.count();

    if (count > 0) {
      const firstHeader = projectHeaders.first();

      // Click to expand
      await firstHeader.click();

      // Wait for expansion animation
      await page.waitForTimeout(500);

      // Get all test items in the expanded list
      const testItems = page.locator('.test-list.expanded .test-item');
      const itemCount = await testItems.count();

      // Verify each test item is visible
      for (let i = 0; i < itemCount; i++) {
        const item = testItems.nth(i);
        await expect(item).toBeVisible();

        // Check that the item is within the viewport or scrollable area
        const isInViewport = await item.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const parent = el.closest('.test-list');
          const parentRect = parent.getBoundingClientRect();

          // Item should be within parent bounds (not clipped)
          return rect.bottom <= parentRect.bottom + 1 ||
                 window.getComputedStyle(parent).overflow !== 'hidden';
        });

        expect(isInViewport).toBe(true);
      }
    }
  });
});

test.describe('API Health', () => {
  test('health endpoint should return healthy status', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('test-dashboard');
  });

  test('projects endpoint should return array', async ({ request }) => {
    const response = await request.get('/api/projects');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('results summary endpoint should return object', async ({ request }) => {
    const response = await request.get('/api/results');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(typeof data).toBe('object');
  });
});

test.describe('UI Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('refresh button should reload results', async ({ page }) => {
    // Click refresh button
    await page.locator('#refreshBtn').click();

    // Should not show error toast
    const toast = page.locator('#toast');
    await page.waitForTimeout(500);

    // If toast is visible, it should not be an error
    const isVisible = await toast.isVisible();
    if (isVisible) {
      const hasErrorClass = await toast.evaluate(el => el.classList.contains('error'));
      expect(hasErrorClass).toBe(false);
    }
  });

  test('loading overlay should be hidden initially', async ({ page }) => {
    const loadingOverlay = page.locator('#loadingOverlay');
    await expect(loadingOverlay).toHaveClass(/hidden/);
  });
});
