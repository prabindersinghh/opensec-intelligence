#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

node -e "
const DGModule = require('./dep-graph.js');
const DependencyGraph = typeof DGModule === 'function' ? DGModule : (DGModule.DependencyGraph || DGModule.default);

// Test 1: Simple linear dependency A -> B -> C
const graph = new DependencyGraph();
graph.addNode('A');
graph.addNode('B');
graph.addNode('C');
graph.addDependency('A', 'B'); // A depends on B
graph.addDependency('B', 'C'); // B depends on C

const order = graph.getOrder();
if (!Array.isArray(order)) { console.error('getOrder() must return array'); process.exit(1); }
if (order.length !== 3) { console.error('Expected 3 nodes in order, got ' + order.length); process.exit(1); }

// C must come before B, B must come before A
const idxA = order.indexOf('A');
const idxB = order.indexOf('B');
const idxC = order.indexOf('C');
if (idxC > idxB || idxB > idxA) {
  // This checks that dependencies come first
  // Actually: C should be processed before B, B before A
  // So in the order array, C should appear before B, B before A
}
// More flexible check: verify each dependency appears before its dependent
if (idxC >= idxB) { console.error('C must come before B in topological order'); process.exit(1); }
if (idxB >= idxA) { console.error('B must come before A in topological order'); process.exit(1); }

// No cycle in this graph
if (graph.detectCycle() === true) {
  console.error('Should not detect cycle in acyclic graph');
  process.exit(1);
}

// Test 2: Cycle detection
const cycleGraph = new DependencyGraph();
cycleGraph.addNode('X');
cycleGraph.addNode('Y');
cycleGraph.addNode('Z');
cycleGraph.addDependency('X', 'Y');
cycleGraph.addDependency('Y', 'Z');
cycleGraph.addDependency('Z', 'X'); // Creates cycle

if (cycleGraph.detectCycle() !== true) {
  console.error('Should detect cycle');
  process.exit(1);
}

// Test 3: Multiple independent nodes
const indGraph = new DependencyGraph();
indGraph.addNode('P');
indGraph.addNode('Q');
const indOrder = indGraph.getOrder();
if (indOrder.length !== 2) {
  console.error('Expected 2 nodes for independent graph');
  process.exit(1);
}

console.log('All dependency graph tests passed');
"
