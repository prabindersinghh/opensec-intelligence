---
name: webapp-testing
description: "Guide for writing tests: unit tests, integration tests, and end-to-end testing strategies"
---

# Testing

## Instructions

When the user asks you to write tests, test a feature, or set up testing:

1. **Choose the right test level:**
   - **Unit tests** — test individual functions/classes in isolation
   - **Integration tests** — test module interactions
   - **E2E tests** — test full user workflows

2. **Test structure** — follow Arrange-Act-Assert (AAA) pattern:
   ```javascript
   test('description', () => {
     // Arrange — set up test data
     // Act — call the function under test
     // Assert — check the result
   });
   ```

3. **Test naming** — use descriptive names: `"should return empty array when input is empty"`

## Unit Testing Best Practices

- Test one behavior per test
- Use descriptive assertion messages
- Test edge cases: empty inputs, null/undefined, boundary values
- Test error cases: invalid input, thrown exceptions
- Avoid testing implementation details — test behavior

## Mocking

- Mock external dependencies (APIs, databases, file system)
- Use minimal mocks — only mock what you need
- Verify mock calls when the interaction IS the behavior

## Testing Frameworks

- **Node.js built-in**: `node:test` with `node:assert`
- **Vitest**: fast, Vite-compatible, ESM native
- **Jest**: mature ecosystem, good for React
- **Playwright**: browser E2E testing
