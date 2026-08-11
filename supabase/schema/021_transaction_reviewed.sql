-- Weekend-reconciliation review, separate from the AI-confidence `needs_review`
-- flag: `needs_review` is Telegram-intake-only and clears the moment a spend
-- looks parseable, so it says nothing about a manually-entered or
-- confidently-extracted row ever having been eyeballed by a human against a
-- statement. `reviewed_at` is that second, independent pass — null until
-- someone taps "Reviewed", timestamped so it can't be confused with the AI flag.
alter table transactions add column if not exists reviewed_at timestamptz;
