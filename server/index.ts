import { createApp } from './app.js';
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
