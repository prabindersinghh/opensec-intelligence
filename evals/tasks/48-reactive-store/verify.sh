#!/bin/bash
set -euo pipefail

node -e "
const { createStore } = require('./store.js');

const store = createStore(
  { count: 0, items: [] },
  {
    increment: (state, payload) => ({ ...state, count: state.count + (payload || 1) }),
    addItem: (state, payload) => ({ ...state, items: [...state.items, payload] }),
  }
);

// Test getState
let s = store.getState();
if (s.count !== 0) { console.error('initial count wrong'); process.exit(1); }

// Test dispatch
store.dispatch({ type: 'increment' });
s = store.getState();
if (s.count !== 1) { console.error('count should be 1, got', s.count); process.exit(1); }

store.dispatch({ type: 'increment', payload: 5 });
s = store.getState();
if (s.count !== 6) { console.error('count should be 6, got', s.count); process.exit(1); }

// Test subscribe
let callCount = 0;
const unsub = store.subscribe(() => callCount++);
store.dispatch({ type: 'increment' });
if (callCount !== 1) { console.error('listener should fire once'); process.exit(1); }

// Test unsubscribe
unsub();
store.dispatch({ type: 'increment' });
if (callCount !== 1) { console.error('listener should not fire after unsub'); process.exit(1); }

// Test addItem
store.dispatch({ type: 'addItem', payload: 'hello' });
s = store.getState();
if (s.items.length !== 1 || s.items[0] !== 'hello') {
  console.error('addItem failed');
  process.exit(1);
}

// Test computed
if (typeof store.computed === 'function') {
  const getCount = store.computed(state => state.count);
  const c = getCount();
  if (c !== store.getState().count) {
    console.error('computed value wrong');
    process.exit(1);
  }
}
"
