#!/bin/bash
node app.js 2>/dev/null | grep -q "Hello, World"
