const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const migrationsDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    console.log(`🔄 Running ${files.length} migration(s)...`);

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`  → ${file}`);

      try {
        await pool.query(sql);
      } catch (err) {
        // Check if it's already exists error
        if (err.message.includes('already exists')) {
          console.log(`    (already exists, skipping)`);
        } else {
          throw err;
        }
      }
    }

    console.log('✓ Migrations complete');
    await pool.end();
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

migrate();
