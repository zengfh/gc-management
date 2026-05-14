import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import type supertest from 'supertest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const [{ default: request }, { createApp }, { openDatabase }] = await Promise.all([
  import('supertest'),
  import('../server/app.js'),
  import('../server/db/index.js'),
]);

type TestAgent = ReturnType<typeof request.agent>;

interface Measurement<T = unknown> {
  label: string;
  durationMs: number;
  thresholdMs: number;
  passed: boolean;
  result: T;
}

const appOrigin = 'http://localhost:5173';
const cardCount = Number(process.env.PERF_CARD_COUNT || 20_000);
const csvRowCount = Number(process.env.PERF_CSV_ROWS || 1_000);

const thresholdsMs = {
  firstPage: Number(process.env.PERF_FIRST_PAGE_MS || 3_000),
  statusFilter: Number(process.env.PERF_STATUS_FILTER_MS || 3_000),
  textSearch: Number(process.env.PERF_TEXT_SEARCH_MS || 5_000),
  burstReads: Number(process.env.PERF_BURST_READS_MS || 8_000),
  csvPreview: Number(process.env.PERF_CSV_PREVIEW_MS || 5_000),
};

function nowIso(offsetSeconds = 0) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)).toISOString();
}

async function setupOwner(agent: TestAgent) {
  const response = await agent.post('/api/auth/setup').send({
    unlockSecret: 'a strong unlock phrase',
  });
  assertStatus(response, 201, 'owner setup');
  return response.body.data.csrfToken;
}

function assertStatus(response: supertest.Response, expectedStatus: number, label: string) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(response.body)}`,
    );
  }
}

function seedCards(db: Database.Database, count: number) {
  const insertCard = db.prepare(
    `INSERT INTO cards (
      accountId, brand, cardType, faceValueCents, remainingBalanceCents,
      purchaseCostCents, status, expirationDate, format, source, notes,
      createdByUserId, updatedByUserId, createdAt, updatedAt
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
  );
  const insertSale = db.prepare(
    `INSERT INTO transactions (
      accountId, cardId, type, buyerName, buyerType, salePriceCents,
      netProceedsCents, remainingBalanceAtSaleCents, statusAtSale,
      platform, transactionDate, notes, createdByUserId, createdAt
    ) VALUES (1, ?, 'sale', ?, 'dealer', ?, ?, ?, 'available', 'CardCash', ?, ?, 1, ?)`,
  );

  const statuses = ['available', 'reserved', 'in_use', 'sold', 'used_up', 'void'];
  const seed = db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const status = statuses[index % statuses.length];
      const faceValueCents = 2_500 + (index % 40) * 500;
      const purchaseCostCents = Math.round(faceValueCents * 0.86);
      const remainingBalanceCents =
        status === 'sold' || status === 'used_up' || status === 'void'
          ? 0
          : status === 'in_use'
            ? Math.max(100, faceValueCents - 500)
            : faceValueCents;
      const timestamp = nowIso(index);
      const info = insertCard.run(
        `Brand ${index % 75}`,
        index % 5 === 0 ? 'prepaid' : 'merchant',
        faceValueCents,
        remainingBalanceCents,
        purchaseCostCents,
        status,
        `2027-${String((index % 12) + 1).padStart(2, '0')}-28`,
        index % 3 === 0 ? 'physical' : 'digital',
        `Source ${index % 20}`,
        `Load smoke note ${index % 100}`,
        timestamp,
        timestamp,
      );

      if (status === 'sold') {
        const salePriceCents = Math.round(faceValueCents * 0.92);
        insertSale.run(
          info.lastInsertRowid,
          `Buyer ${index % 30}`,
          salePriceCents,
          salePriceCents,
          faceValueCents,
          timestamp.slice(0, 10),
          `Sale smoke note ${index}`,
          timestamp,
        );
      }
    }
  });

  seed();
}

function buildCsv(rowCount: number) {
  const rows = [
    'brand,cardType,faceValue,purchaseCost,cardNumber,pin,billingZip,expirationDate,format,source,notes',
  ];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push(
      [
        `Import Brand ${index % 25}`,
        'merchant',
        '50.00',
        '43.50',
        `700000000000${String(index).padStart(4, '0')}`,
        String(1000 + (index % 9000)),
        '94105',
        '2028-12-31',
        index % 2 === 0 ? 'digital' : 'physical',
        `Import Source ${index % 10}`,
        `Import preview smoke ${index}`,
      ].join(','),
    );
  }
  return rows.join('\n');
}

async function measure<T>(label: string, thresholdMs: number, action: () => Promise<T> | T): Promise<Measurement<T>> {
  const start = performance.now();
  const result = await action();
  const durationMs = performance.now() - start;
  return {
    label,
    durationMs,
    thresholdMs,
    passed: durationMs <= thresholdMs,
    result,
  };
}

function printMeasurement(measurement: Measurement) {
  const duration = `${measurement.durationMs.toFixed(1)}ms`;
  const threshold = `${measurement.thresholdMs.toFixed(0)}ms`;
  console.log(`${measurement.passed ? 'PASS' : 'FAIL'} ${measurement.label}: ${duration} / ${threshold}`);
}

async function main() {
  const db = openDatabase({ filename: ':memory:' });
  try {
    const agent = request.agent(createApp({ db }));
    const csrfToken = await setupOwner(agent);

    const seedStart = performance.now();
    seedCards(db, cardCount);
    const seedDurationMs = performance.now() - seedStart;
    console.log(`Seeded ${cardCount.toLocaleString()} cards in ${seedDurationMs.toFixed(1)}ms`);

    const measurements: Measurement[] = [];
    measurements.push(
      await measure('20k card first page', thresholdsMs.firstPage, async () => {
        const response = await agent.get('/api/cards?limit=100&offset=0');
        assertStatus(response, 200, 'first page');
        if (response.body.page.total !== cardCount) {
          throw new Error(`first page total was ${response.body.page.total}, expected ${cardCount}`);
        }
        return response.body.page;
      }),
    );

    measurements.push(
      await measure('20k card status filter', thresholdsMs.statusFilter, async () => {
        const response = await agent.get('/api/cards?status=available&limit=100&offset=0');
        assertStatus(response, 200, 'status filter');
        if ((response.body.data as Array<{ status: string }>).some((card) => card.status !== 'available')) {
          throw new Error('status filter returned a non-available card');
        }
        return response.body.page;
      }),
    );

    measurements.push(
      await measure('20k card text search', thresholdsMs.textSearch, async () => {
        const response = await agent.get('/api/cards?text=load%20smoke%20note%2042&limit=100&offset=0');
        assertStatus(response, 200, 'text search');
        if (response.body.page.total === 0) {
          throw new Error('text search returned no matching rows');
        }
        return response.body.page;
      }),
    );

    measurements.push(
      await measure('25 high-frequency list reads', thresholdsMs.burstReads, async () => {
        for (let index = 0; index < 25; index += 1) {
          const response = await agent.get(
            `/api/cards?status=reserved&limit=100&offset=${(index * 20) % 1_000}`,
          );
          assertStatus(response, 200, `burst read ${index + 1}`);
          if ((response.body.data as Array<{ status: string }>).some((card) => card.status !== 'reserved')) {
            throw new Error('burst status filter returned a non-reserved card');
          }
        }
      }),
    );

    measurements.push(
      await measure('1k CSV import preview', thresholdsMs.csvPreview, async () => {
        const response = await agent
          .post('/api/cards/import-csv')
          .set('Origin', appOrigin)
          .set('X-CSRF-Token', csrfToken)
          .send({ csv: buildCsv(csvRowCount) });
        assertStatus(response, 200, 'CSV import preview');
        if (response.body.data.summary.validCount !== csvRowCount) {
          throw new Error(
            `CSV preview valid count was ${response.body.data.summary.validCount}, expected ${csvRowCount}`,
          );
        }
        return response.body.data.summary;
      }),
    );

    const failed = measurements.filter((measurement) => !measurement.passed);
    for (const measurement of measurements) {
      printMeasurement(measurement);
    }

    if (failed.length > 0) {
      throw new Error(`${failed.length} performance smoke measurement(s) exceeded threshold.`);
    }

    console.log('Performance smoke passed.');
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
