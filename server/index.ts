import { createApp } from './app.js';
import { refreshAiImportModelOptions } from './aiImport.js';
import { openDatabase } from './db/index.js';
import { startExpirationNotificationScheduler } from './notifications/expiration.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const db = openDatabase();
const app = createApp({ db });

app.listen(port, host, () => {
  const address = host || '0.0.0.0';
  console.log(`Gift Card Manager listening on http://${address}:${port}`);
});

startExpirationNotificationScheduler({ db });

async function refreshAiModels(reason: string) {
  try {
    const result = await refreshAiImportModelOptions();
    console.log(JSON.stringify({
      level: 'info',
      event: 'ai_import.models_refreshed',
      reason,
      optionCount: result.options.length,
      defaultSelection: result.defaultSelection,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'ai_import.models_refresh_failed',
      reason,
      message: error instanceof Error ? error.message : 'unknown error',
    }));
  }
}

process.on('SIGUSR2', () => {
  void refreshAiModels('signal');
});

setTimeout(() => {
  void refreshAiModels('startup');
}, 5_000);

setInterval(() => {
  void refreshAiModels('interval');
}, 24 * 60 * 60 * 1_000).unref();
