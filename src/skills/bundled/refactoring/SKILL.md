---
name: refactoring
description: "Patterns and strategies for safely refactoring code"
---

# Refactoring

## Instructions

When the user asks you to refactor, clean up, or restructure code:

1. **Understand first** — read all related code before making changes
2. **Preserve behavior** — refactoring changes structure, not functionality
3. **Small steps** — make one change at a time, verify it works
4. **Keep tests passing** — if tests exist, run them after each change

## Common Refactoring Patterns

### Extract Function
Pull a block of code into its own function when:
- The block has a clear single purpose
- The same logic is duplicated elsewhere
- The containing function is too long (>30 lines)

### Extract Module
Split a large file into separate modules when:
- Functions fall into distinct categories
- The file exceeds 200-300 lines
- Different parts have different dependencies

### Replace Callbacks with Async/Await
- Convert callback-style APIs to promise-based
- Use `util.promisify()` for Node.js callback APIs
- Replace `.then()` chains with async/await

### Simplify Conditionals
- Extract complex boolean expressions into named variables
- Use early returns to reduce nesting
- Replace if-else chains with lookup objects/maps

### Remove Duplication
- Identify repeated code patterns
- Extract shared logic into a common function
- Use higher-order functions for similar-but-different operations

## Safety Checklist

- [ ] All existing tests pass after each change  
- [ ] No new functionality was added
- [ ] Exported API surface is unchanged
- [ ] No behavior changes (just structure)
