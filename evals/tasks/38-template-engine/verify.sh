#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

node -e "
const mod = require('./template.js');
const render = typeof mod === 'function' ? mod : (mod.render || mod.default);

// Test 1: Simple variable substitution
const t1 = render('Hello {{name}}!', { name: 'World' });
if (t1 !== 'Hello World!') {
  console.error('Variable substitution failed: got \"' + t1 + '\"');
  process.exit(1);
}

// Test 2: Multiple variables
const t2 = render('{{greeting}}, {{name}}!', { greeting: 'Hi', name: 'Alice' });
if (t2 !== 'Hi, Alice!') {
  console.error('Multiple variables failed: got \"' + t2 + '\"');
  process.exit(1);
}

// Test 3: If block (truthy)
const t3 = render('{{#if show}}visible{{/if}}', { show: true });
if (t3.trim() !== 'visible') {
  console.error('If block (truthy) failed: got \"' + t3 + '\"');
  process.exit(1);
}

// Test 4: If block (falsy)
const t4 = render('{{#if show}}visible{{/if}}', { show: false });
if (t4.trim() !== '') {
  console.error('If block (falsy) failed: got \"' + t4 + '\"');
  process.exit(1);
}

// Test 5: Each loop
const t5 = render('{{#each items}}{{this}} {{/each}}', { items: ['a', 'b', 'c'] });
if (t5.trim() !== 'a b c') {
  console.error('Each loop failed: got \"' + t5.trim() + '\"');
  process.exit(1);
}

// Test 6: Combined template
const t6 = render(
  'Users: {{#each users}}{{this}}, {{/each}}{{#if admin}}(admin){{/if}}',
  { users: ['Alice', 'Bob'], admin: true }
);
if (!t6.includes('Alice') || !t6.includes('Bob') || !t6.includes('(admin)')) {
  console.error('Combined template failed: got \"' + t6 + '\"');
  process.exit(1);
}

// Test 7: If block with falsy value hides content
const t7 = render('before{{#if hidden}}SECRET{{/if}}after', { hidden: false });
if (t7.trim() !== 'beforeafter') {
  console.error('Falsy if block should hide content: got \"' + t7 + '\"');
  process.exit(1);
}

console.log('All template engine tests passed');
"
