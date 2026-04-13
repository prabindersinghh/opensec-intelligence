const { parentPort } = require('worker_threads');

parentPort.on('message', (n) => {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  parentPort.postMessage(result);
});
