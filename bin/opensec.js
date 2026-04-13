#!/usr/bin/env node
import('../dist/bin/cmdr.js').catch(e => { console.error(e); process.exit(1) })
