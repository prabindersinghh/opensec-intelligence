#!/usr/bin/env bash
set -euo pipefail

if [ ! -f state-machine.js ]; then
  echo "FAIL: state-machine.js not found"
  exit 1
fi

node -e "
const mod = require('./state-machine');
const StateMachine = typeof mod === 'function' ? mod : (mod.StateMachine || mod.default);
if (!StateMachine) { console.log('FAIL: could not find StateMachine export'); process.exit(1); }

const transitions = {
  'idle.start': 'running',
  'running.pause': 'paused',
  'running.stop': 'idle',
  'paused.resume': 'running',
  'paused.stop': 'idle',
};

const sm = new StateMachine('idle', transitions);

// Test initial state
if (sm.currentState !== 'idle') {
  console.log('FAIL: initial state should be idle, got', sm.currentState);
  process.exit(1);
}

// Test valid transition
sm.send('start');
if (sm.currentState !== 'running') {
  console.log('FAIL: after start, state should be running, got', sm.currentState);
  process.exit(1);
}

sm.send('pause');
if (sm.currentState !== 'paused') {
  console.log('FAIL: after pause, state should be paused, got', sm.currentState);
  process.exit(1);
}

sm.send('resume');
if (sm.currentState !== 'running') {
  console.log('FAIL: after resume, state should be running, got', sm.currentState);
  process.exit(1);
}

sm.send('stop');
if (sm.currentState !== 'idle') {
  console.log('FAIL: after stop, state should be idle, got', sm.currentState);
  process.exit(1);
}

// Test invalid transition throws
try {
  sm.send('pause');
  console.log('FAIL: invalid transition idle.pause should throw');
  process.exit(1);
} catch (e) {
  // expected
}

// Test onTransition callback
const sm2 = new StateMachine('idle', transitions);
const transitionLog = [];
sm2.onTransition((from, to, event) => {
  transitionLog.push({ from, to, event });
});

sm2.send('start');
sm2.send('stop');

if (transitionLog.length !== 2) {
  console.log('FAIL: onTransition should have been called twice, got', transitionLog.length);
  process.exit(1);
}

if (transitionLog[0].from !== 'idle' || transitionLog[0].to !== 'running') {
  console.log('FAIL: first transition wrong', transitionLog[0]);
  process.exit(1);
}

if (transitionLog[1].from !== 'running' || transitionLog[1].to !== 'idle') {
  console.log('FAIL: second transition wrong', transitionLog[1]);
  process.exit(1);
}

console.log('PASS');
"
