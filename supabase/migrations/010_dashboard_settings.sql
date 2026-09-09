-- Per-client targets and health weights.
--
-- Both were hardcoded, so "Target 24 hours" appeared on screen with nothing to
-- say who decided that, and a client whose branches are shopping-mall kiosks
-- was measured against the same reply-time standard as a flagship restaurant.
-- Now the client owns both, and the dashboard can show the arithmetic instead
-- of asserting a grade.
--
-- Stored as one jsonb blob rather than a column per setting: these are read and
-- written together, and adding a measure later should not need a migration.
-- A null column means "use the house defaults" — see lib/dashboard-advisor.ts.

alter table public.client_databases
  add column if not exists dashboard_settings jsonb;

comment on column public.client_databases.dashboard_settings is
  'Client-owned dashboard targets and health-score weights. Null = house defaults. '
  'Shape: {"targets":{"sentiment":75,"rating":4.3,"negativeShare":10,"replyRate":80,"replyHours":24},'
  '"weights":{"feeling":0.55,"replyRate":0.20,"rating":0.15,"volume":0.10}}';
