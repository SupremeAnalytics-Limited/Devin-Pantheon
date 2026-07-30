-- CarSpa call + booking log (D1 database: carspa-calls)

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT UNIQUE,
  call_type TEXT NOT NULL DEFAULT 'unknown', -- 'customer' | 'employee' | 'unknown'
  phone_number TEXT,
  customer_name TEXT,
  service_requested TEXT,
  employee_role TEXT,
  employee_email TEXT,
  status TEXT,
  duration_seconds INTEGER,
  transcript TEXT,
  onboarding_email_sent INTEGER NOT NULL DEFAULT 0,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_call_id ON calls(call_id);
CREATE INDEX IF NOT EXISTS idx_calls_call_type ON calls(call_type);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calendly_event_uri TEXT UNIQUE,
  invitee_name TEXT,
  invitee_email TEXT,
  invitee_phone TEXT,
  event_start_time TEXT,
  event_type_uri TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'canceled'
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_event_uri ON bookings(calendly_event_uri);
