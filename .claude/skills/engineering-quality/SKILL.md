---
name: engineering-quality
description: Apply TourPilot's mandatory Kaizen, Clean Code, reliability, security, data-integrity, observability, testing, and long-term maintainability standards to implementation, refactoring, debugging, architecture, migrations, integrations, and code review.
---

# Engineering Quality Skill

Use this skill for every non-trivial code or architecture change.

Read first:
- `@.claude/docs/engineering-constitution.md`
- `@.claude/docs/coding-standards.md`
- `@.claude/docs/definition-of-done.md`
- relevant domain docs and skills for the task

## Working method

1. Inspect before editing.
   - Understand the existing implementation, source of truth, tests, and operational dependencies.
   - Do not assume a rewrite is needed.

2. State the invariant or requirement.
   - Define what must remain true before choosing an implementation.
   - For bugs, identify the root cause before patching the symptom.

3. Prefer Kaizen.
   - Make the smallest coherent, reversible improvement.
   - Preserve working behavior and backward compatibility unless change is intentional.
   - Do not mix unrelated cleanup into the task.

4. Keep code clean and explicit.
   - Clear names, focused responsibilities, typed boundaries, deterministic rules.
   - Avoid duplication of business logic, broad `any`, hidden fallbacks, magic values, swallowed errors, and premature abstraction.

5. Design for failure where the domain requires it.
   - Consider retries, duplicate delivery, double-submit, concurrency, partial failure, timeout, recovery, and auditability.
   - Enforce correctness server-side and at the database boundary where appropriate.

6. Protect data and security.
   - Never invent uncertain operational data.
   - Validate input and authorization.
   - Use least privilege and fail closed for security-sensitive decisions.
   - Never expose secrets.

7. Verify the change.
   - Run relevant typechecks, builds, and focused tests.
   - Add regression coverage for bug fixes when practical.
   - Check mobile/PWA, RBAC, migrations, integrations, idempotency, and observability when applicable.

8. Review the final diff.
   - Remove debug code and accidental changes.
   - Confirm the solution did not create a second source of truth or parallel architecture.

9. Apply the Definition of Done.
   - Report READY only if all relevant gates pass.
   - Report BLOCKED when material risk or required verification remains unresolved.

## Long-term gate

Before finalizing significant work, ask:

> Does this only work today, or will another engineer be able to understand, operate, debug, and safely extend it three to five years from now?

If the second answer is weak, improve the design before declaring completion.