# ADR 0002: Single Account with Productization Seams

## Status

Accepted

## Context

The PRD defines a local MVP while preserving a path toward team or product modes. The app does not need real multi-user behavior for the first release, but retrofitting account boundaries later would be expensive.

## Decision

Seed one default account and one owner user for MVP. Keep `accountId`, `userId`, role, and audit actor fields in the schema from day one.

## Consequences

The first release can avoid RBAC and tenant-management UI, while database queries still develop with account scoping discipline. Future team support can build on the existing schema instead of splitting shared tables later.
