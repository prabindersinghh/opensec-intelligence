let count = 0;

async function increment() {
  const current = count;
  await new Promise(r => setTimeout(r, Math.random() * 10));
  count = current + 1;
  return count;
}

async function incrementAll(n) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(increment());
  }
  await Promise.all(promises);
  return count;
}

function getCount() { return count; }
function reset() { count = 0; }

module.exports = { incrementAll, getCount, reset };
