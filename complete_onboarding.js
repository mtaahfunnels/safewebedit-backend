const crypto = require('crypto');
const { execSync } = require('child_process');
const db = require('./src/services/database');

const organizationId = '1e9b2c9a-366a-4882-a5eb-77bbcdfc147a';
const email = 'wisevirgins247@gmail.com';
const name = 'dggdfgfdg';

async function completeOnboarding() {
  try {
    console.log('Starting manual onboarding completion for:', email);

    // 1. Create Keycloak user WITHOUT password
    console.log('\n1. Creating Keycloak user...');
    const tokenCmd = `docker exec safewebedit-keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password "admin" 2>&1 | grep -v "Logging into"`;
    execSync(tokenCmd, { stdio: 'pipe' });

    const createUserCmd = `docker exec safewebedit-keycloak /opt/keycloak/bin/kcadm.sh create users -r safewebedit -s username="${email}" -s email="${email}" -s enabled=true -s emailVerified=false 2>&1`;
    const output = execSync(createUserCmd, { encoding: 'utf8', stdio: 'pipe' });

    const userIdMatch = output.match(/id '([^']+)'/);
    const keycloakUserId = userIdMatch ? userIdMatch[1] : null;

    if (!keycloakUserId) {
      throw new Error('Failed to extract Keycloak user ID');
    }

    console.log('✓ Keycloak user created:', keycloakUserId);

    // Update organization with Keycloak ID
    await db.query(
      'UPDATE organizations SET keycloak_id = $1 WHERE id = $2',
      [keycloakUserId, organizationId]
    );

    // 2. Create password setup token
    console.log('\n2. Creating password setup token...');
    
    // Delete old tokens
    await db.query(
      'DELETE FROM password_reset_tokens WHERE organization_id = $1',
      [organizationId]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await db.query(
      `INSERT INTO password_reset_tokens (organization_id, token, email, expires_at, used)
       VALUES ($1, $2, $3, $4, false)`,
      [organizationId, token, email, expiresAt]
    );

    console.log('✓ Password setup token created');

    // 3. Display password setup link
    const setupUrl = `https://safewebedit.com/setup-password?token=${token}`;
    
    console.log('\n' + '='.repeat(70));
    console.log('PASSWORD SETUP EMAIL');
    console.log('='.repeat(70));
    console.log(`To: ${email}`);
    console.log(`Business: ${name}`);
    console.log(`Setup URL: ${setupUrl}`);
    console.log('='.repeat(70));
    console.log('\n✅ Onboarding completed! User can now set their password.');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

completeOnboarding();
