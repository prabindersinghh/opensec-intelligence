#!/bin/bash
# Verify hello.txt exists and contains the expected text
[[ -f hello.txt ]] && grep -q "Hello, cmdr" hello.txt
