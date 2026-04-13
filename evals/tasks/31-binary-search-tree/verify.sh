#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

node -e "
const BinarySearchTree = require('./bst.js');
const bst = new (typeof BinarySearchTree === 'function' ? BinarySearchTree : BinarySearchTree.BinarySearchTree || BinarySearchTree.default)();

// Insert values
[5,3,7,1,4,6,8].forEach(v => bst.insert(v));

// Test search
if (!bst.search(5)) { console.error('search(5) should be true'); process.exit(1); }
if (!bst.search(1)) { console.error('search(1) should be true'); process.exit(1); }
if (!bst.search(8)) { console.error('search(8) should be true'); process.exit(1); }
if (bst.search(99)) { console.error('search(99) should be false'); process.exit(1); }
if (bst.search(0)) { console.error('search(0) should be false'); process.exit(1); }

// Test inOrder
const sorted = bst.inOrder();
const expected = [1,3,4,5,6,7,8];
if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
  console.error('inOrder() expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(sorted));
  process.exit(1);
}

// Test min and max
if (bst.min() !== 1) { console.error('min() should be 1, got ' + bst.min()); process.exit(1); }
if (bst.max() !== 8) { console.error('max() should be 8, got ' + bst.max()); process.exit(1); }

console.log('All BST tests passed');
"
