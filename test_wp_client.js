const WordPressClient = require('./src/services/wordpress');

console.log('[TEST] Creating WordPressClient...');
const client = new WordPressClient(
  'https://workaiflow.com',
  'admin',
  'QcRr bO5f K02e vUeq UaC0 alcG'
);

console.log('[TEST] Calling verifyConnection...');
client.verifyConnection()
  .then(result => {
    console.log('[TEST] Result:', JSON.stringify(result, null, 2));
    if (result.success) {
      console.log('[TEST] SUCCESS!');
    } else {
      console.log('[TEST] FAILED!');
    }
  })
  .catch(error => {
    console.log('[TEST] Exception:', error.message);
  });
