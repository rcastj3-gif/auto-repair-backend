import { openDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const db = openDatabase();
createApp(db).listen(port, () => {
  console.log(`Auto repair backend running at http://localhost:${port}`);
});
