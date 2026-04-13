function sum(numbers) {
  let total = 0;
  for (const n of numbers) {
    total += n;
  }
  return total;
}

function average(numbers) {
  // Bug: dividing by wrong value
  return sum(numbers) / numbers.length + 1;
}

module.exports = { sum, average };
