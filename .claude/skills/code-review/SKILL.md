---
name: code-review
description: "Review code for best practices, modularity, scalability, abstraction, and test coverage. Generates detailed report with issues and recommendations."
---

# Code Review

Perform a comprehensive code review of recent changes or specified files to ensure quality standards.

## Review Criteria

### 1. Best Practices
- Follows TypeScript strict mode conventions
- Proper error handling (try/catch, error types, no silent failures)
- No hardcoded values (use environment variables or constants)
- Proper logging with appropriate log levels
- Security best practices (input validation, no SQL injection, XSS prevention)
- No console.log in production code (use logger)

### 2. Modularity
- Single responsibility principle (each function/class does one thing)
- Functions are small and focused (< 50 lines ideally)
- No code duplication (DRY principle)
- Clear separation of concerns (routes, services, utilities)

### 3. Scalability
- Efficient database queries (proper indexing, no N+1 queries)
- Connection pooling used correctly
- Async operations handled properly
- No blocking operations in hot paths

### 4. Abstraction
- Interfaces/types defined for all public APIs
- Implementation details hidden behind abstractions
- Adapter pattern used for external services (LLM, database)
- Configuration externalized (not hardcoded)

### 5. Test Coverage
- Unit tests exist for all utility functions
- Service layer has integration tests
- Edge cases are covered
- Test file exists in `__tests__/` folder alongside source

## Output Format

```markdown
## Code Review Report

### Files Reviewed
- List of files

### Issues Found

#### 🔴 Critical
- [file:line] Description - Recommendation

#### 🟡 Warning
- [file:line] Description - Recommendation

#### 🔵 Suggestions
- [file:line] Description - Recommendation

### Test Coverage
- Files missing tests
- Coverage gaps

### Summary
- Total issues count
- Action items
```
