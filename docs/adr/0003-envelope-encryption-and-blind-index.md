# ADR 0003: Envelope Encryption and Blind Index

## Status

Accepted

## Context

Gift-card credentials are spendable secrets. The app needs encrypted storage and exact full-card-number search without plaintext database search.

## Decision

Generate a random DEK at setup. Derive a KEK from the unlock secret and salt, then wrap the DEK for storage. Keep the unwrapped DEK only in process memory after login.

Encrypt sensitive card fields with AES-256-GCM. Derive a separate HMAC key from the DEK using HKDF domain separation for card-number blind indexes.

## Consequences

Server restart locks encrypted data until login. Exact card-number search is supported through the blind index; partial card-number search is intentionally out of scope unless a safer tokenization design is approved.
