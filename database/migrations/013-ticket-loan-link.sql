BEGIN;

ALTER TABLE tickets
  ADD COLUMN loan_id BIGINT REFERENCES loans(id) ON DELETE SET NULL;

CREATE INDEX tickets_loan_idx ON tickets(loan_id);

COMMIT;
