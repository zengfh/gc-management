import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const unlockSecret = 'a strong unlock phrase';
const backupPassphrase = 'release five portable backup';
const fixturePath = path.join(process.cwd(), 'test-data/release5_acceptance_cards.csv');

async function setupOrUnlockVault(page) {
  await page.goto('/');
  const setupHeading = page.getByRole('heading', { name: /create unlock secret/i });
  const unlockHeading = page.getByRole('heading', { name: /unlock card data/i });
  const dashboardHeading = page.getByRole('heading', { name: /dashboard/i });

  await expect(setupHeading.or(unlockHeading).or(dashboardHeading)).toBeVisible();
  if (await setupHeading.isVisible()) {
    await page.getByLabel(/^owner email$/i).fill('release5-owner@example.com');
    await page.getByLabel(/^display name$/i).fill('Release 5 Owner');
    await page.getByLabel(/^unlock secret$/i).fill(unlockSecret);
    await page.getByLabel(/confirm unlock secret/i).fill(unlockSecret);
    await page.getByRole('checkbox', { name: /required to unlock encrypted card data/i }).check();
    await page.getByRole('button', { name: /create secure vault/i }).click();
  } else if (await unlockHeading.isVisible()) {
    await page.getByLabel(/^unlock secret$/i).fill(unlockSecret);
    await page.getByRole('button', { name: /^unlock$/i }).click();
  }
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

async function importAcceptanceCsv(page) {
  const csv = await fs.readFile(fixturePath);
  await page.getByRole('button', { name: /^backup$/i }).click();
  await page.getByLabel(/^csv file$/i).setInputFiles({
    name: 'release5_acceptance_cards.csv',
    mimeType: 'text/csv',
    buffer: csv,
  });
  await page.getByRole('button', { name: /^preview csv$/i }).click();
  await expect(page.getByText(/6 valid/i)).toBeVisible();
  await expect(page.getByText(/0 invalid/i)).toBeVisible();
  await expect(page.getByText(/6 rows/i)).toBeVisible();
  await expect(page.getByRole('row', { name: /uber.*redemption code.*\*\*\*\*605a/i })).toBeVisible();
  await expect(page.getByRole('row', { name: /starbucks.*barcode.*\*\*\*\*5678/i })).toBeVisible();

  await page.getByRole('button', { name: /^confirm csv import$/i }).click();
  await expect(page.getByText(/imported 6 cards/i)).toBeVisible();
}

async function searchCredential(page, credential, brandPattern) {
  await page.getByRole('button', { name: /^cards$/i }).click();
  await page.getByLabel(/^exact credential$/i).fill(credential);
  await page.getByRole('button', { name: /^search cards$/i }).click();
  await expect(page.getByRole('row', { name: brandPattern })).toBeVisible();
}

async function openCardDetails(page, brandPattern) {
  await page.getByRole('button', { name: brandPattern }).click();
  const dialog = page.getByRole('dialog', { name: /card details/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function exportEncryptedBackup(page) {
  await page.getByRole('button', { name: /^backup$/i }).click();
  await page.getByLabel(/^encrypted export unlock secret$/i).fill(unlockSecret);
  await page.getByLabel(/^backup passphrase$/i).fill(backupPassphrase);
  await page.getByLabel(/^repeat backup passphrase$/i).fill(backupPassphrase);
  await page.getByLabel(/^type ENCRYPT to confirm$/i).fill('ENCRYPT');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /^export encrypted json$/i }).click();
  const download = await downloadPromise;
  await expect(page.getByText(/encrypted export prepared/i)).toBeVisible();
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  return {
    filename: download.suggestedFilename(),
    buffer: await fs.readFile(downloadPath),
  };
}

async function restoreEncryptedBackup(page, backup) {
  await page.getByLabel(/^encrypted json backup file$/i).setInputFiles({
    name: backup.filename,
    mimeType: 'application/json',
    buffer: backup.buffer,
  });
  await page.getByRole('combobox', { name: /^encrypted import mode$/i }).selectOption('replace');
  await page.getByLabel(/^encrypted import unlock secret$/i).fill(unlockSecret);
  await page.getByLabel(/^encrypted import backup passphrase$/i).fill(backupPassphrase);
  await page.getByLabel(/^type REPLACE to confirm$/i).fill('REPLACE');
  await page.getByRole('button', { name: /^import encrypted json backup$/i }).click();
  await expect(page.getByText(/encrypted json replace import completed: \d+ cards/i)).toBeVisible();
}

test.describe.serial('Release 5 browser acceptance', () => {
  test('imports mainstream credential profiles and restores encrypted backup', async ({ page }) => {
    test.setTimeout(180_000);
    await setupOrUnlockVault(page);
    await importAcceptanceCsv(page);

    await searchCredential(page, 'UBERTEST202605A', /available.*uber/i);
    await searchCredential(page, '9900000000001001', /available.*best buy/i);
    await searchCredential(page, '7788899900012345678', /available.*starbucks/i);
    await searchCredential(page, 'GCMEMBER-12345', /available.*local boutique/i);

    await searchCredential(page, '7788899900012345678', /available.*starbucks/i);
    const starbucksDialog = await openCardDetails(page, /open starbucks details/i);
    await starbucksDialog.getByRole('button', { name: /^reveal credentials$/i }).click();
    await expect(starbucksDialog.getByText('7788899900012345678')).toBeVisible();
    await expect(starbucksDialog.getByRole('img', { name: /scannable barcode/i })).toBeVisible();
    await starbucksDialog.getByRole('button', { name: /close card details/i }).click();

    await searchCredential(page, '4111111111111111', /available.*vanilla visa/i);
    const prepaidDialog = await openCardDetails(page, /open vanilla visa details/i);
    await prepaidDialog.getByRole('button', { name: /^reveal credentials$/i }).click();
    await expect(prepaidDialog.locator('.credential-section').getByText(/^Security code$/)).toHaveCount(0);
    await prepaidDialog.getByRole('button', { name: /close card details/i }).click();

    const backup = await exportEncryptedBackup(page);
    await restoreEncryptedBackup(page, backup);
    await searchCredential(page, 'UBERTEST202605A', /available.*uber/i);
    await searchCredential(page, '7788899900012345678', /available.*starbucks/i);
  });
});
