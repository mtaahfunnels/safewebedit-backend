const path = require('path');
console.log('__dirname:', __dirname);
console.log('Screenshots path:', path.join(__dirname, '../screenshots'));
console.log('Resolved:', path.resolve(__dirname, '../screenshots'));
