const fs = require('fs');
const path = require('path');
const pool = require('./pool');
(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema...');
  await pool.query(sql);
  console.log('Schema applied.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
