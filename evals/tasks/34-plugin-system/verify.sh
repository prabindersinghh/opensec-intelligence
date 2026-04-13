#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

[ -f plugin-host.js ] || { echo "plugin-host.js missing"; exit 1; }
[ -f sample-plugins.js ] || { echo "sample-plugins.js missing"; exit 1; }

node -e "
const PluginHostModule = require('./plugin-host.js');
const PluginHost = typeof PluginHostModule === 'function' ? PluginHostModule : (PluginHostModule.PluginHost || PluginHostModule.default);
const plugins = require('./sample-plugins.js');

const host = new PluginHost();

// Get the sample plugins (could be array or object with named exports)
const pluginList = Array.isArray(plugins) ? plugins : Object.values(plugins).filter(p => p && typeof p === 'object' && p.execute);

if (pluginList.length < 2) {
  console.error('sample-plugins.js must export at least 2 plugins');
  process.exit(1);
}

// Register plugins
pluginList.forEach(p => host.register(p.name, p));

// Test listPlugins
const listed = host.listPlugins();
if (!Array.isArray(listed) || listed.length < 2) {
  console.error('listPlugins() should return array with at least 2 plugins');
  process.exit(1);
}

// Find uppercase and reverse plugins
const uppercaseName = pluginList.find(p => p.name === 'uppercase' || p.name === 'Uppercase')?.name;
const reverseName = pluginList.find(p => p.name === 'reverse' || p.name === 'Reverse')?.name;

if (!uppercaseName || !reverseName) {
  console.error('Must have uppercase and reverse plugins');
  process.exit(1);
}

// Test execute
const upperResult = host.execute(uppercaseName, 'hello');
if (upperResult !== 'HELLO') {
  console.error('uppercase plugin should return HELLO, got: ' + upperResult);
  process.exit(1);
}

const reverseResult = host.execute(reverseName, 'hello');
if (reverseResult !== 'olleh') {
  console.error('reverse plugin should return olleh, got: ' + reverseResult);
  process.exit(1);
}

// Test unregister
host.unregister(uppercaseName);
const afterUnregister = host.listPlugins();
if (afterUnregister.length !== pluginList.length - 1) {
  console.error('After unregister, plugin count should decrease by 1');
  process.exit(1);
}

console.log('All plugin system tests passed');
"
