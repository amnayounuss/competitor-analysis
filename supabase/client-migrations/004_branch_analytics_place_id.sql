-- Add place_id to branch_analytics.
--
-- The dashboard dedups branches across jobs by place_id when available
-- (app/(authenticated)/dashboard/page.tsx), falling back to brand+name+city.
-- The column was present in the pre-self-hosted cloud schema but missing from
-- client-schema.sql, so cloud→self-hosted row inserts failed with
-- "column place_id does not exist" and were silently dropped.

alter table if exists branch_analytics
  add column if not exists place_id text;

create index if not exists branch_analytics_place_idx
  on branch_analytics (place_id);
