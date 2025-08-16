# Testing Strategy

This document outlines the testing strategy for the wedding website project. While the project includes a suite of tests, it's important to note that they were not consistently maintained and may not all be passing. This document serves to explain the existing setup and provide a path forward.

## Tech Stack

- **Framework:** [Jest](https://jestjs.io/)
- **Utilities:** [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- **Environment:** [JSDOM](https://github.com/jsdom/jsdom) to simulate a browser environment for component tests.
- **Language:** TypeScript, with tests written in `.test.ts` and `.test.tsx` files.

## How to Run Tests

You can run the entire test suite using the following npm script:

```bash
npm test
```

This command does a few things:
1.  It first executes the `pretest` script (`scripts/pretest.sh`), which ensures all `npm` dependencies are installed.
2.  It then runs `jest`, which discovers and runs all test files in the project.

You can also run Jest in watch mode, which is useful during development:

```bash
npm run test:watch
```

## Test Structure

Tests are co-located with the source code in `__tests__` directories. For example:
-   Component tests are in `src/components/__tests__/`.
-   API route tests are in `src/app/api/__tests__/`.
-   Service tests are in `src/services/__tests__/`.

This structure makes it easy to find the tests associated with a specific part of the application.

## Current State & Path Forward

**Current State:**
As noted in the main `README.md`, the tests have not been actively maintained. Many may be failing due to changes in the code, UI, or data models. They were created during initial development but fell by the wayside.

**Path Forward:**
Improving the test suite is a high-impact area for contributions. Here is a recommended approach:

1.  **Triage Existing Tests:** Go through the test suite (`npm test`) and identify which tests are failing. For each failing test, determine if it's failing because of a bug in the code or because the test itself is outdated.
2.  **Fix or Delete Outdated Tests:** Update tests that are outdated. If a test is for a feature that no longer exists or has been fundamentally changed, it might be better to delete it and write a new one from scratch.
3.  **Increase Coverage:** Add new tests for critical user flows that are not currently covered. Good candidates for new tests include:
    -   The full "add to registry" and "contribute to item" flows.
    -   Admin authentication and authorization logic.
    -   Edge cases for the filtering and sorting logic on the registry page.
4.  **Adopt a Convention:** For new tests, follow the existing conventions of using React Testing Library to test components from a user's perspective. Avoid testing implementation details.

Contributions to improve the test suite are highly encouraged and will be greatly appreciated!
