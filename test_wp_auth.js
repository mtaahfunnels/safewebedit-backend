const axios = require('axios');

const client = axios.create({
  baseURL: 'https://workaiflow.com/wp-json/wp/v2',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  auth: {
    username: 'admin',
    password: '4aBeraO3DzIWSkiMqi7fsxFv',
  },
});

client.get('/users/me')
  .then(response => {
    console.log('SUCCESS:', response.data.name);
  })
  .catch(error => {
    console.log('ERROR:', error.response?.status, error.response?.data || error.message);
  });
