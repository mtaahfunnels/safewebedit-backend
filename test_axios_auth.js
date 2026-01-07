const axios = require('axios');

// Test with the exact same setup as WordPressClient
const client = axios.create({
  baseURL: 'https://workaiflow.com/wp-json/wp/v2',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  auth: {
    username: 'admin',
    password: 'QcRrbO5fK02evUeqUaC0alcG',
  },
});

console.log('[TEST] Testing axios auth with WordPress...');
console.log('[TEST] Username:', 'admin');
console.log('[TEST] Password:', 'QcRrbO5fK02evUeqUaC0alcG');

client.get('/users/me')
  .then(response => {
    console.log('[TEST] SUCCESS! Got user:', response.data.name);
    console.log('[TEST] User ID:', response.data.id);
  })
  .catch(error => {
    console.log('[TEST] FAILED!');
    console.log('[TEST] Status:', error.response?.status);
    console.log('[TEST] Error:', error.response?.data || error.message);
    console.log('[TEST] Headers sent:', error.config?.headers);
  });
