CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE employee (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK (role IN ('EMPLOYEE', 'MANAGER', 'ADMIN')),
  manager_id INTEGER REFERENCES employee(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leave_type (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  days_per_year INTEGER NOT NULL CHECK (days_per_year >= 0)
);

INSERT INTO leave_type (code, name, days_per_year) VALUES
  ('ANNUAL', 'Annual leave', 10),
  ('SICK', 'Sick leave', 30),
  ('PERSONAL', 'Personal leave', 3);

CREATE TABLE leave_request (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  leave_type_id INTEGER NOT NULL REFERENCES leave_type(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC(4,1) NOT NULL CHECK (days > 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  decided_by INTEGER REFERENCES employee(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_dates CHECK (end_date >= start_date),
  CONSTRAINT no_overlapping_leave EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status IN ('PENDING', 'APPROVED'))
);
