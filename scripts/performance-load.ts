import { performance } from 'node:perf_hooks';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const [{ default: request }, { createApp }, { openDatabase }] = await Promise.all([
  import('supertest'),
  import('../server/app.js'),
  import('../server/db/index.js'),
]);

const appOrigin = 'http://localhost:5173';
const cardCount = Number(process.env.PERF_LOAD_CARD_COUNT || 50_000);
const referenceCount = Number(process.env.PERF_LOAD_REFERENCE_COUNT || 500);
const readIterations = Number(process.env.PERF_LOAD_READ_ITERATIONS || 60);
const concurrentReads = Number(process.env.PERF_LOAD_CONCURRENT_READS || 40);
const concurrentBatchSize = Number(process.env.PERF_LOAD_CONCURRENT_BATCH_SIZE || 2);
const csvRowCount = Number(process.env.PERF_LOAD_CSV_ROWS || 2_000);

const thresholdsMs = {
  firstPageP95: Number(process.env.PERF_LOAD_FIRST_PAGE_P95_MS || 600),
  statusFilterP95: Number(process.env.PERF_LOAD_STATUS_P95_MS || 750),
  textSearchP95: Number(process.env.PERF_LOAD_TEXT_P95_MS || 1_500),
  referenceSearchP95: Number(process.env.PERF_LOAD_REFERENCE_P95_MS || 500),
  concurrentReadsTotal: Number(process.env.PERF_LOAD_CONCURRENT_READS_MS || 12_000),
  csvPreview: Number(process.env.PERF_LOAD_CSV_PREVIEW_MS || 10_000),
};

function nowIso(offsetSeconds = 0) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)).toISOString();
}

function assertStatus(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(response.body)}`,
    );
  }
}

async function setupOwner(agent) {
  const response = await agent.post('/api/auth/setup').send({
    unlockSecret: 'a strong unlock phrase',
  });
  assertStatus(response, 201, 'owner setup');
  return response.body.data.csrfToken;
}

function seedCards(db, count) {
  const insertCard = db.prepare(
    `INSERT INTO cards (
      accountId, brand, cardType, faceValueCents, remainingBalanceCents,
      purchaseCostCents, status, expirationDate, format, source, notes,
      createdByUserId, updatedByUserId, createdAt, updatedAt
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
  );
  const statuses = ['available', 'reserved', 'in_use', 'sold', 'used_up', 'void'];
  const seed = db.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const status = statuses[index % statuses.length];
      const faceValueCents = 2_500 + (index % 40) * 500;
      const remainingBalanceCents =
        status === 'sold' || status === 'used_up' || status === 'void'
          ? 0
          : status === 'in_use'
            ? Math.max(100, faceValueCents - 500)
            : faceValueCents;
      const timestamp = nowIso(index);
      insertCard.run(
        `Brand ${index % 150}`,
        index % 5 === 0 ? 'prepaid' : 'merchant',
        faceValueCents,
        remainingBalanceCents,
        Math.round(faceValueCents * 0.86),
        status,
        `2027-${String((index % 12) + 1).padStart(2, '0')}-28`,
        index % 3 === 0 ? 'physical' : 'digital',
        `Source ${index % 40}`,
        `Load test note ${index % 250}`,
        timestamp,
        timestamp,
      );
    }
  });

  seed();
}

function seedReferenceValues(db, count) {
  const insertReference = db.prepare(
    `INSERT INTO reference_values (
      accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const types = ['deal_name', 'source', 'card_brand'];
  const seed = db.transaction(() => {
    for (const type of types) {
      for (let index = 0; index < count; index += 1) {
        const value = `${type.replace('_', ' ')} ${index}`;
        const timestamp = nowIso(index);
        insertReference.run(
          type,
          value,
          value.toLowerCase(),
          count - index,
          timestamp,
          timestamp,
          timestamp,
        );
      }
    }
  });

  seed();
}

function buildCsv(rowCount) {
  const rows = [
    'brand,cardType,faceValue,purchaseCost,cardNumber,pin,billingZip,expirationDate,format,source,notes',
  ];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push(
      [
        `Load Import Brand ${index % 50}`,
        'merchant',
        '50.00',
        '43.50',
        `800000000000${String(index).padStart(4, '0')}`,
        String(1000 + (index % 9000)),
        '94105',
        '2028-12-31',
        index % 2 === 0 ? 'digital' : 'physical',
        `Load Import Source ${index % 20}`,
        `Load import preview ${index}`,
      ].join(','),
    );
  }
  return rows.join('\n');
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

async function measureOne(label, thresholdMs, action) {
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

async function measureSeries(label, iterations, thresholdMs, action) {
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    await action(index);
    durations.push(performance.now() - start);
  }
  const p95 = percentile(durations, 0.95);
  return {
    label,
    durationMs: p95,
    thresholdMs,
    passed: p95 <= thresholdMs,
    result: {
      minMs: Math.min(...durations),
      p50Ms: percentile(durations, 0.5),
      p95Ms: p95,
      maxMs: Math.max(...durations),
    },
  };
}

function printMeasurement(measurement) {
  const duration = `${measurement.durationMs.toFixed(1)}ms`;
  const threshold = `${measurement.thresholdMs.toFixed(0)}ms`;
  const details = measurement.result?.p95Ms
    ? ` p50=${measurement.result.p50Ms.toFixed(1)}ms max=${measurement.result.maxMs.toFixed(1)}ms`
    : '';
  console.log(`${measurement.passed ? 'PASS' : 'FAIL'} ${measurement.label}: ${duration} / ${threshold}${details}`);
}

async function main() {
  const db = openDatabase({ filename: ':memory:' });
  try {
    const agent = request.agent(createApp({ db }));
    const csrfToken = await setupOwner(agent);

    const seedStart = performance.now();
    seedCards(db, cardCount);
    seedReferenceValues(db, referenceCount);
    const seedDurationMs = performance.now() - seedStart;
    console.log(
      `Seeded ${cardCount.toLocaleString()} cards and ${(referenceCount * 3).toLocaleString()} reference values in ${seedDurationMs.toFixed(1)}ms`,
    );

    const measurements = [];
    measurements.push(
      await measureSeries(`${cardCount.toLocaleString()} cards first page p95`, readIterations, thresholdsMs.firstPageP95, async (index) => {
        const response = await agent.get(`/api/cards?limit=100&offset=${(index * 37) % 5_000}`);
        assertStatus(response, 200, `first page ${index}`);
        if (response.body.page.total !== cardCount) {
          throw new Error(`card total was ${response.body.page.total}, expected ${cardCount}`);
        }
      }),
    );
    measurements.push(
      await measureSeries(`${cardCount.toLocaleString()} cards status filter p95`, readIterations, thresholdsMs.statusFilterP95, async (index) => {
        const response = await agent.get(`/api/cards?status=available&limit=100&offset=${(index * 11) % 2_000}`);
        assertStatus(response, 200, `status filter ${index}`);
        if (response.body.data.some((card) => card.status !== 'available')) {
          throw new Error('status filter returned a non-available card');
        }
      }),
    );
    measurements.push(
      await measureSeries(`${cardCount.toLocaleString()} cards text search p95`, readIterations, thresholdsMs.textSearchP95, async (index) => {
        const query = encodeURIComponent(`load test note ${index % 250}`);
        const response = await agent.get(`/api/cards?text=${query}&limit=100&offset=0`);
        assertStatus(response, 200, `text search ${index}`);
        if (response.body.page.total === 0) {
          throw new Error('text search returned no matching rows');
        }
      }),
    );
    measurements.push(
      await measureSeries(
        'reference substring search p95',
        readIterations,
        thresholdsMs.referenceSearchP95,
        async (index) => {
          const response = await agent.get(`/api/reference-values?types=card_brand&q=${index % 10}&limit=25`);
          assertStatus(response, 200, `reference search ${index}`);
          if (!Array.isArray(response.body.data.card_brand)) {
            throw new Error('reference search did not return card_brand array');
          }
        },
      ),
    );
    measurements.push(
      await measureOne(`${concurrentReads} batched mixed reads`, thresholdsMs.concurrentReadsTotal, async () => {
        for (let start = 0; start < concurrentReads; start += concurrentBatchSize) {
          const batchSize = Math.min(concurrentBatchSize, concurrentReads - start);
          const responses = await Promise.all(
            Array.from({ length: batchSize }, (_unused, batchIndex) => {
              const index = start + batchIndex;
              if (index % 3 === 0) {
                return agent.get(`/api/cards?limit=50&offset=${(index * 13) % 5_000}`);
              }
              if (index % 3 === 1) {
                return agent.get(`/api/cards?status=reserved&limit=50&offset=${(index * 7) % 2_000}`);
              }
              return agent.get(`/api/reference-values?types=source&q=${index % 20}&limit=10`);
            }),
          );
          responses.forEach((response, index) => assertStatus(response, 200, `concurrent read ${start + index}`));
        }
      }),
    );
    measurements.push(
      await measureOne('2k CSV import preview', thresholdsMs.csvPreview, async () => {
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
      }),
    );

    const failed = measurements.filter((measurement) => !measurement.passed);
    for (const measurement of measurements) {
      printMeasurement(measurement);
    }
    if (failed.length > 0) {
      throw new Error(`${failed.length} load measurement(s) exceeded threshold.`);
    }
    console.log('Performance load test passed.');
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
