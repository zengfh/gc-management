```markdown
# gc-management Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `gc-management` TypeScript codebase. The repository is framework-agnostic, focusing on custom TypeScript logic for garbage collection management. You'll learn about file naming, import/export styles, commit conventions, and how to work with the testing patterns present in the codebase.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userManager.ts`, `gcController.ts`

### Import Style
- Use **relative imports** for referencing other modules within the project.
  - Example:
    ```typescript
    import { getUser } from './userManager';
    ```

### Export Style
- Both **named** and **default exports** are used.
  - Named export example:
    ```typescript
    export function cleanUp() { ... }
    ```
  - Default export example:
    ```typescript
    export default class GcController { ... }
    ```

### Commit Patterns
- Commit messages are **freeform** with no strict prefix requirements.
- Average commit message length: ~34 characters.
  - Example: `fix memory leak in gcManager`

## Workflows

### General Development
**Trigger:** When adding or updating features or bug fixes.
**Command:** `/dev`

1. Create or update TypeScript files using camelCase naming.
2. Use relative imports to reference other modules.
3. Choose named or default exports as appropriate.
4. Write concise, descriptive commit messages.

### Testing
**Trigger:** When verifying functionality or adding new features.
**Command:** `/test`

1. Create test files matching the `*.test.*` pattern (e.g., `gcController.test.ts`).
2. Write tests using the project's chosen (unknown) testing framework.
3. Run tests to ensure all cases pass.

## Testing Patterns

- Test files follow the `*.test.*` naming convention.
  - Example: `userManager.test.ts`
- The specific testing framework is not detected, so refer to existing test files for structure.
- Place test files alongside or near the modules they test.

## Commands
| Command | Purpose |
|---------|---------|
| /dev    | Start or continue general development (features, fixes) |
| /test   | Run or add tests following the `*.test.*` pattern       |
```
