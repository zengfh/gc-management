import fs from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { uberSpreadsheetContinuation } from '../src/testFixtures/bulkImportSamples.js';

const unlockSecret = 'a strong unlock phrase';
const backupPassphrase = 'portable backup passphrase';

async function unlockExistingVault(page: Page) {
  await page.goto('/');
  const unlockHeading = page.getByRole('heading', { name: /unlock card data/i });
  const dashboardHeading = page.getByRole('heading', { name: /dashboard/i });
  await expect(unlockHeading.or(dashboardHeading)).toBeVisible();
  if (await unlockHeading.isVisible()) {
    await page.getByLabel(/^unlock secret$/i).fill(unlockSecret);
    await page.getByRole('button', { name: /^unlock$/i }).click();
  }
  await expect(dashboardHeading).toBeVisible();
}

async function setupOrUnlockVault(page: Page) {
  await page.goto('/');
  const setupHeading = page.getByRole('heading', { name: /create unlock secret/i });
  const unlockHeading = page.getByRole('heading', { name: /unlock card data/i });
  const dashboardHeading = page.getByRole('heading', { name: /dashboard/i });

  await expect(setupHeading.or(unlockHeading).or(dashboardHeading)).toBeVisible();
  if (await setupHeading.isVisible()) {
    await page.getByLabel(/^owner email$/i).fill('mvp-owner@example.com');
    await page.getByLabel(/^display name$/i).fill('MVP Owner');
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

test.describe.serial('MVP Release 1 critical flows', () => {
  test('setup, add a deal, and search by exact card number', async ({ page }) => {
    await setupOrUnlockVault(page);
    await page.getByRole('button', { name: /add deal/i }).click();
    await page.getByLabel(/^deal name/i).fill('Staples May promo');
    await page.getByLabel(/^source$/i).fill('Staples');
    await page.getByLabel(/^total cost$/i).fill('45.00');
    await page.getByLabel(/^card brand$/i).fill('Target');
    await page.getByLabel(/^face value$/i).fill('50.00');
    await page.getByLabel(/^card number$/i).fill('4111 1111 1111 1111');
    await page.getByRole('button', { name: /^create deal$/i }).click();
    await page
      .getByRole('dialog', { name: /review new entries/i })
      .getByRole('button', { name: /^create deal$/i })
      .click();

    await page.getByRole('button', { name: /^cards$/i }).click();
    await expect(page.getByRole('row', { name: /available.*target/i })).toBeVisible();
    await page.getByLabel(/^exact credential$/i).fill('4111 1111 1111 1111');
    await page.getByRole('button', { name: /^search cards$/i }).click();

    await expect(page.getByRole('row', { name: /available.*target/i })).toBeVisible();
    await expect(page.getByText('4111 1111 1111 1111')).toHaveCount(0);
  });

  test('reserve, sell, and undo sale from the card table', async ({ page }) => {
    await unlockExistingVault(page);

    await page.getByRole('button', { name: /^cards$/i }).click();
    await page.getByRole('button', { name: /reserve target/i }).click();
    await page.getByRole('dialog', { name: /reserve card/i }).getByLabel(/^reserved for$/i).fill('Dealer A');
    await page.getByRole('dialog', { name: /reserve card/i }).getByLabel(/^reserved until$/i).fill('2026-06-01');
    await page.getByRole('dialog', { name: /reserve card/i }).getByRole('button', { name: /^reserve card$/i }).click();
    await expect(page.getByRole('row', { name: /reserved.*target/i })).toBeVisible();

    await page.getByRole('button', { name: /sell target/i }).click();
    await page.getByLabel(/^sale price$/i).fill('48.00');
    await page.getByLabel(/^buyer$/i).fill('Dealer A');
    await page.getByRole('combobox', { name: /^buyer type$/i }).selectOption('dealer');
    await page.getByRole('button', { name: /^record sale$/i }).click();
    await expect(page.getByRole('row', { name: /sold.*target/i })).toBeVisible();

    await page.getByRole('button', { name: /undo sale target/i }).click();
    await page.getByLabel(/^reason$/i).fill('Buyer canceled');
    await page.getByRole('button', { name: /^undo sale$/i }).click();
    await expect(page.getByRole('row', { name: /reserved.*target/i })).toBeVisible();
  });

  test('record usage and undo the usage from card detail', async ({ page }) => {
    await unlockExistingVault(page);

    await page.getByRole('button', { name: /^cards$/i }).click();
    await page.getByRole('button', { name: /unreserve target/i }).click();
    await expect(page.getByRole('row', { name: /available.*target/i })).toBeVisible();

    await page.getByRole('button', { name: /use target/i }).click();
    await page.getByLabel(/^amount$/i).fill('12.50');
    await page.getByLabel(/^merchant$/i).fill('Target');
    await page.getByRole('button', { name: /^record usage$/i }).click();
    await expect(page.getByRole('row', { name: /in use.*target/i })).toBeVisible();
    await expect(page.getByText('$37.50')).toBeVisible();

    await page.getByRole('button', { name: /open target details/i }).click();
    const detail = page.getByRole('dialog', { name: /card details/i });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: /undo target usage/i }).click();
    await detail.getByLabel(/^reason$/i).fill('Mistyped amount');
    await detail.getByRole('button', { name: /^undo usage$/i }).click();
    await expect(detail.getByText(/reversed/i)).toBeVisible();
    await page.getByRole('button', { name: /close card details/i }).click();
    await expect(page.getByRole('row', { name: /available.*target/i })).toBeVisible();
  });

  test('preview and confirm CSV import without rendering full credentials', async ({ page }) => {
    await unlockExistingVault(page);

    await page.getByRole('button', { name: /^backup$/i }).click();
    const invalidCsv = [
      'brand,cardType,faceValue,cardNumber,pin',
      'Amazon,merchant,25,4222222222222222,9999',
      ',merchant,0,4333333333333333,3333',
    ].join('\n');
    await page.getByLabel(/^csv file$/i).setInputFiles({
      name: 'invalid-cards.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(invalidCsv),
    });
    await page.getByRole('button', { name: /^preview csv$/i }).click();
    await expect(page.getByText(/1 valid/i)).toBeVisible();
    await expect(page.getByText(/1 invalid/i)).toBeVisible();
    await expect(page.getByText('4222222222222222')).toHaveCount(0);
    await expect(page.getByText('9999')).toHaveCount(0);

    const validCsv = 'brand,cardType,faceValue,cardNumber,pin\nAmazon,merchant,25,4222222222222222,9999';
    await page.getByLabel(/^csv file$/i).setInputFiles({
      name: 'valid-cards.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(validCsv),
    });
    await page.getByRole('button', { name: /^preview csv$/i }).click();
    await page.getByRole('button', { name: /^confirm csv import$/i }).click();
    await expect(page.getByText(/imported 1 card/i)).toBeVisible();
    await expect(page.getByText(/2 cards tracked/i)).toBeVisible();
  });

  test('bulk import analyzes pasted rows in one review and imports atomically', async ({ page }) => {
    await setupOrUnlockVault(page);

    await page.getByRole('button', { name: /^bulk import$/i }).click();
    await page.getByLabel(/^gift-card lines$/i).fill([
      'Doordash 50 DD-E2E-CODE',
      'Bestbuy $50 BB-E2E-CARD BB-E2E-PIN',
    ].join('\n'));
    await page.getByRole('button', { name: /^fast parse \(rules\)$/i }).click();

    const review = page.getByRole('dialog', { name: /^review parsed cards$/i });
    await expect(review).toBeVisible();
    await expect(review.getByLabel(/^line 1 brand$/i)).toHaveValue('DoorDash');
    await expect(review.getByLabel(/^line 2 PIN$/i)).toHaveValue('BB-E2E-PIN');
    await review.getByLabel(/^line 1 source$/i).fill('Promo');
    await review.getByLabel(/^line 2 notes$/i).fill('Email delivery');
    await review.getByRole('button', { name: /^import 2 cards$/i }).click();

    await expect(page.getByText(/imported 2 cards/i)).toBeVisible();
    await page.getByRole('button', { name: /^close bulk import$/i }).click();
    await page.getByRole('button', { name: /^cards$/i }).click();
    await expect(page.getByRole('row', { name: /available.*doordash/i })).toBeVisible();
    await expect(page.getByRole('row', { name: /available.*best buy/i })).toBeVisible();
    await expect(page.getByText('DD-E2E-CODE')).toHaveCount(0);
    await expect(page.getByText('BB-E2E-PIN')).toHaveCount(0);
  });

  test('bulk import review stays readable for real spreadsheet paste on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupOrUnlockVault(page);

    await page.getByRole('button', { name: /^bulk import$/i }).click();
    await page.getByLabel(/^gift-card lines$/i).fill(uberSpreadsheetContinuation);
    await page.getByRole('button', { name: /^fast parse \(rules\)$/i }).click();

    const review = page.getByRole('dialog', { name: /^review parsed cards$/i });
    await expect(review).toBeVisible();
    await expect(review.getByText(/8 parsed/i)).toBeVisible();
    await expect(review.getByText(/0 need edits/i)).toBeVisible();
    await expect(review.getByLabel(/^line 8 code or card number$/i)).toHaveValue('NAAD XUP5 8VDB ZV93');
    await expect(review.locator('td[data-label="Status"]').first()).toBeVisible();

    const reviewWrap = review.locator('.bulk-review-wrap');
    await expect.poll(async () =>
      reviewWrap.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  });

  test('plaintext export requires confirmation controls', async ({ page }) => {
    await unlockExistingVault(page);

    await page.getByRole('button', { name: /^backup$/i }).click();
    await page.getByLabel(/^fresh unlock secret$/i).fill(unlockSecret);
    await page.getByLabel(/^type EXPORT to confirm$/i).fill('EXPORT');
    await page.getByRole('checkbox', { name: /contains spendable credentials/i }).check();
    await page.getByRole('button', { name: /^export plaintext json$/i }).click();

    await expect(page.getByText(/plaintext export prepared/i)).toBeVisible();
  });

  test('encrypted export can be restored through replace import', async ({ page }) => {
    test.setTimeout(120_000);
    await unlockExistingVault(page);

    await page.getByRole('button', { name: /^backup$/i }).click();
    await page.getByLabel(/^encrypted export unlock secret$/i).fill(unlockSecret);
    await page.getByLabel(/^backup passphrase$/i).fill(backupPassphrase);
    await page.getByLabel(/^repeat backup passphrase$/i).fill(backupPassphrase);
    await page.getByLabel(/^type ENCRYPT to confirm$/i).fill('ENCRYPT');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /^export encrypted json$/i }).click();
    const download = await downloadPromise;
    await expect(page.getByText(/encrypted export prepared/i)).toBeVisible();
    expect(download.suggestedFilename()).toMatch(/^gift-card-encrypted-export-\d{4}-\d{2}-\d{2}\.json$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const backupBuffer = await fs.readFile(downloadPath);

    await page.getByLabel(/^encrypted json backup file$/i).setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/json',
      buffer: backupBuffer,
    });
    await page.getByRole('combobox', { name: /^encrypted import mode$/i }).selectOption('replace');
    await page.getByLabel(/^encrypted import unlock secret$/i).fill(unlockSecret);
    await page.getByLabel(/^encrypted import backup passphrase$/i).fill(backupPassphrase);
    await page.getByLabel(/^type REPLACE to confirm$/i).fill('REPLACE');
    await page.getByRole('button', { name: /^import encrypted json backup$/i }).click();

    await expect(page.getByText(/encrypted json replace import completed/i)).toBeVisible();
    await page.getByRole('button', { name: /^cards$/i }).click();
    await expect(page.getByRole('row', { name: /available.*target/i })).toBeVisible();
    await expect(page.getByRole('row', { name: /available.*amazon/i })).toBeVisible();
    await expect(page.getByText('4111 1111 1111 1111')).toHaveCount(0);
    await expect(page.getByText('4222222222222222')).toHaveCount(0);
  });

  test('revealed credentials disappear after logout', async ({ page }) => {
    await unlockExistingVault(page);

    await page.getByRole('button', { name: /^cards$/i }).click();
    await page.getByRole('button', { name: /open amazon details/i }).click();
    await page.getByRole('button', { name: /^reveal credentials$/i }).click();
    await expect(page.getByText('4222222222222222')).toBeVisible();

    await page
      .getByRole('dialog', { name: /card details/i })
      .getByRole('button', { name: /^logout$/i })
      .click();
    await expect(page.getByRole('heading', { name: /unlock card data/i })).toBeVisible();
    await expect(page.getByText('4222222222222222')).toHaveCount(0);
  });
});
