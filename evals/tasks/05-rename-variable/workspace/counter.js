let x = 0;

function increment() {
  x += 1;
  return x;
}

function decrement() {
  x -= 1;
  return x;
}

function reset() {
  x = 0;
}

module.exports = { increment, decrement, reset };
