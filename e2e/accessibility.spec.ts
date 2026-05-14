import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const unlockSecret = 'a strong unlock phrase';

async function ensureUnlocked(page) {
  await page.goto('/');

  const setupHeading = page.getByRole('heading', { name: /create unlock secret/i });
  const unlockHeading = page.getByRole('heading', { name: /unlock card data/i });
  const dashboardHeading = page.getByRole('heading', { name: /dashboard/i });

  await expect(setupHeading.or(unlockHeading).or(dashboardHeading)).toBeVisible();

  if (await setupHeading.isVisible()) {
    await page.getByLabel(/^owner email$/i).fill('accessibility-owner@example.com');
    await page.getByLabel(/^display name$/i).fill('Accessibility Owner');
    await page.getByLabel(/^unlock secret$/i).fill(unlockSecret);
    await page.getByLabel(/confirm unlock secret/i).fill(unlockSecret);
    await page.getByRole('checkbox', { name: /required to unlock encrypted card data/i }).check();
    await page.getByRole('button', { name: /create secure vault/i }).click();
  } else if (await unlockHeading.isVisible()) {
    await page.getByLabel(/^unlock secret$/i).fill(unlockSecret);
    await page.getByRole('button', { name: /^unlock$/i }).click();
  }

  await expect(dashboardHeading).toBeVisible();
}

async function expectNoAxeViolations(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
    `${label} accessibility violations`,
  ).toEqual([]);
}

test.describe.serial('Accessibility smoke', () => {
  test('core workspace screens pass automated WCAG A/AA axe checks', async ({ page }) => {
    await ensureUnlocked(page);
    await expectNoAxeViolations(page, 'Dashboard');

    await page.getByRole('button', { name: /^cards$/i }).click();
    await expect(page.getByRole('heading', { name: /^cards$/i })).toBeVisible();
    await expectNoAxeViolations(page, 'Cards');

    await page.getByRole('button', { name: /^add deal$/i }).click();
    await expect(page.getByRole('dialog', { name: /^add deal$/i })).toBeVisible();
    await expectNoAxeViolations(page, 'Add deal dialog');
    await page.getByRole('button', { name: /^close add deal$/i }).click();

    await page.getByRole('button', { name: /^backup$/i }).click();
    await expect(page.getByRole('heading', { name: /^backup$/i })).toBeVisible();
    await expectNoAxeViolations(page, 'Backup');

    await page.getByRole('button', { name: /^settings$/i }).click();
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();
    await expectNoAxeViolations(page, 'Settings');
  });
});
