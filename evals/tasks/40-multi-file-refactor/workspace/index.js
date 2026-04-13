function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function multiply(a, b) { return a * b; }

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function reverse(str) { return str.split('').reverse().join(''); }
function truncate(str, len) { return str.length > len ? str.slice(0, len) + '...' : str; }

function unique(arr) { return [...new Set(arr)]; }
function flatten(arr) { return arr.reduce((acc, val) => acc.concat(val), []); }
function last(arr) { return arr[arr.length - 1]; }

module.exports = { add, subtract, multiply, capitalize, reverse, truncate, unique, flatten, last };
