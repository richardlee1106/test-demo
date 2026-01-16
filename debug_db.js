import 'dotenv/config'; // Load .env
import { initDatabase, getPool } from './fastify-backend/services/database.js';
import { getCategoryTreeFromDB } from './fastify-backend/services/catalog.js';
import fs from 'fs';

async function test() {
  const logFile = 'check_output.txt';
  let out = '';
  try {
    out += `Using Database: ${process.env.POSTGRES_DATABASE}\n`;
    out += 'Starting DB check...\n';
    await initDatabase();
    out += 'DB connected successfully.\n';
    
    const tree = await getCategoryTreeFromDB();
    out += `Category tree top level nodes: ${tree.length}\n`;
    
    const pool = getPool();
    const countRes = await pool.query('SELECT count(*) FROM pois');
    out += `POI count in table 'pois': ${countRes.rows[0].count}\n`;
    
  } catch (err) {
    out += `ERROR: ${err.message}\n`;
    out += err.stack + '\n';
  }
  fs.writeFileSync(logFile, out);
  console.log(out);
}

test().then(() => process.exit());
