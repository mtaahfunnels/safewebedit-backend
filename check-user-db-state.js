const { Client } = require('pg');

async function checkUserDbState() {
  const client = new Client({
    host: 'localhost',
    port: 5433,  // SafeWebEdit Keycloak Postgres port
    database: 'safewebedit_keycloak',
    user: 'safewebedit_keycloak',
    password: 'safewebedit_kc_2026'
  });

  try {
    await client.connect();
    console.log('Connected to Keycloak database\n');

    const userId = '32b3f73c-ec33-483e-a186-a0c91ada7f14';

    // Check USER_ENTITY table
    console.log('[1/4] Checking USER_ENTITY table...');
    const userResult = await client.query(
      'SELECT id, username, email, email_verified, enabled FROM USER_ENTITY WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      console.log('  Username:', user.username);
      console.log('  Email:', user.email);
      console.log('  Email Verified:', user.email_verified);
      console.log('  Enabled:', user.enabled);
    } else {
      console.log('  User not found!');
    }

    // Check USER_REQUIRED_ACTION table
    console.log('\n[2/4] Checking USER_REQUIRED_ACTION table...');
    const requiredActionsResult = await client.query(
      'SELECT required_action FROM USER_REQUIRED_ACTION WHERE user_id = $1',
      [userId]
    );
    
    if (requiredActionsResult.rows.length > 0) {
      console.log('  Required Actions Found:');
      requiredActionsResult.rows.forEach(row => {
        console.log('    -', row.required_action);
      });
    } else {
      console.log('  No required actions found');
    }

    // Check CREDENTIAL table
    console.log('\n[3/4] Checking CREDENTIAL table...');
    const credentialResult = await client.query(
      'SELECT type, created_date FROM CREDENTIAL WHERE user_id = $1',
      [userId]
    );
    
    if (credentialResult.rows.length > 0) {
      console.log('  Credentials:');
      credentialResult.rows.forEach(row => {
        console.log('    Type:', row.type, '| Created:', new Date(parseInt(row.created_date)));
      });
    } else {
      console.log('  No credentials found');
    }

    // Check USER_ATTRIBUTE table
    console.log('\n[4/4] Checking USER_ATTRIBUTE table...');
    const attributesResult = await client.query(
      'SELECT name, value FROM USER_ATTRIBUTE WHERE user_id = $1',
      [userId]
    );
    
    if (attributesResult.rows.length > 0) {
      console.log('  Attributes:');
      attributesResult.rows.forEach(row => {
        console.log('    ', row.name + ':', row.value);
      });
    } else {
      console.log('  No custom attributes');
    }

    await client.end();

  } catch (error) {
    console.error('Database Error:', error.message);
    process.exit(1);
  }
}

checkUserDbState();
