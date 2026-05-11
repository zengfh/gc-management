import { createApp } from './app.js';
import { openDatabase } from './db/index.js';

const port = Number(process.env.PORT || 3001);
const db = openDatabase();
const app = createApp({ db });

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
