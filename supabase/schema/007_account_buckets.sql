-- Our Money v4 — four-account structure
-- Descriptive metadata on existing accounts (not a new table): which of the
-- four conceptual household buckets an account maps to. Labeling only, no
-- automated money movement.

alter table accounts add column if not exists bucket text
  check (bucket in ('joint', 'emergency_house', 'shrey_personal', 'wife_personal'));
