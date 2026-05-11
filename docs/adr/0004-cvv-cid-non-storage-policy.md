# ADR 0004: CVV/CID Non-Storage Policy

## Status

Accepted

## Context

Network-branded prepaid Visa, Mastercard, American Express, Discover, and similar CVV/CID values create compliance and liability risk if persisted.

## Decision

Do not persist network-branded prepaid CVV/CID values in product mode, even encrypted. Merchant gift-card PINs may be stored encrypted because they are distinct from network payment-card security codes.

## Consequences

The UI must not present CVV/CID as a normal saved credential for network-branded cards. Exports, logs, and audit records must omit CVV/CID unless a private/local deployment explicitly disables the policy and documents that exception.
