const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://safewebedits_user:SafeWeb2026Edits@localhost:5432/safewebedits_db'
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Running Google Sheets database migration...\n');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_sheets_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        sheet_id VARCHAR(255) NOT NULL,
        sheet_name VARCHAR(255),
        service_account_email VARCHAR(255),
        credentials_json TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id)
      );
    `);
    console.log('✓ Created google_sheets_configs table');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS slot_sheet_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slot_id UUID NOT NULL REFERENCES content_slots(id) ON DELETE CASCADE,
        sheet_column VARCHAR(100) NOT NULL,
        sheet_row_identifier VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(slot_id)
      );
    `);
    console.log('✓ Created slot_sheet_mappings table');
    
    await client.query(`CREATE INDEX IF NOT EXISTS idx_google_sheets_org ON google_sheets_configs(organization_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_slot_mappings_slot ON slot_sheet_mappings(slot_id);`);
    console.log('✓ Created indexes');
    
    console.log('\n=== Migration completed successfully ===');
    
  } catch (err) {
    console.error('Migration error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
