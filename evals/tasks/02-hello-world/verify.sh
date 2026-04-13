#!/bin/bash
[[ -f hello.py ]] && python3 hello.py 2>/dev/null | grep -q "Hello, World"
