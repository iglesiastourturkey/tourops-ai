---
name: Permission seed synchronization
description: How role-permission defaults stay current when new modules add permissions
---

When adding a permission to the default role matrix, seed role-permission records with an upsert that refreshes the `granted` value for existing role/permission pairs rather than only ignoring conflicts.

**Why:** Existing installations already have a complete role-permission matrix. An insert-on-conflict-do-nothing strategy leaves a newly introduced permission false for those established roles, even though the code's intended default says it should be allowed.

**How to apply:** Permission seed startup logic should use the matrix as the source of truth for default grants. Changes made deliberately through the role-management UI should be represented as per-user overrides or a separately designed customization layer before changing this behavior.