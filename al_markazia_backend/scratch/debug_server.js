try {
  console.log('Starting server load test...');
  require('../src/server.js');
  console.log('Server loaded successfully.');
} catch (error) {
  console.error('SERVER LOAD ERROR:');
  console.error(error.stack || error);
  process.exit(2);
}
