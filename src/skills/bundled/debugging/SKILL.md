---
name: debugging
description: "Systematic debugging strategies for finding and fixing bugs"
---

# Debugging

## Instructions

When the user asks you to debug, fix a bug, or investigate an error:

1. **Read the error message carefully** — extract the error type, message, stack trace, and file locations
2. **Reproduce the issue** — understand the exact steps/input that trigger the bug
3. **Isolate the problem** — narrow down which function/module is responsible
4. **Form a hypothesis** — based on the error, what could be wrong?
5. **Verify and fix** — apply the minimal fix, then verify it works

## Common Bug Patterns

### Off-by-one errors
- Check loop boundaries: `<` vs `<=`, array indexing starting at 0
- Check string slicing: `slice(0, n)` is exclusive of `n`

### Async bugs
- Missing `await` on async functions
- Race conditions in parallel operations
- Callback not being called or called multiple times

### Type coercion
- `==` vs `===` in JavaScript
- String + Number concatenation instead of addition
- Falsy values: `0`, `""`, `null`, `undefined`, `NaN`

### Reference vs Value
- Object mutation: modifying shared references
- Array methods: `sort()` mutates in place, `map()` creates new array
- Spread operator for shallow clone: `{...obj}`, `[...arr]`

## Debugging Strategy

1. **Add strategic logging** — log inputs, intermediate values, and outputs
2. **Binary search the code** — comment out half, see if bug persists
3. **Check recent changes** — `git diff` to see what changed
4. **Simplify the test case** — reduce to minimal reproduction
