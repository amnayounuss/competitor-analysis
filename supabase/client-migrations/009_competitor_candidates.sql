-- ============================================================
--  009_competitor_candidates.sql
--
--  Output of automatic competitor discovery: brands found near the client's
--  own locations, for the client to confirm or reject.
--
--  Why candidates rather than an answer:
--    Category matching alone is not enough. BRGR is a `restaurant`; Dopamine —
--    which the client names as its competitor — is a `cafe`/`bakery`. They share
--    only the generic `food` type, so a same-category search would never surface
--    it. Discovery therefore searches the broad food umbrella and RANKS by how
--    many of the client's own locations a brand sits near. That finds real rivals
--    across category lines, but it also surfaces neighbours, so the client has
--    the final say. Nothing enters an analysis until status = 'confirmed'.
--
--  co_location_count is the signal that matters. A brand near 12 of 29 branches
--  is competing with you; a brand near 1 is next door to one shop.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

create table if not exists competitor_candidates (
  id                 uuid        primary key default gen_random_uuid(),

  -- Identity. brand_key is the normalised form used for grouping and matching;
  -- brand_name is what gets shown and what goes into a job.
  brand_key          text        not null,
  brand_name         text        not null,
  aliases            text[]      not null default '{}',

  -- Evidence, so the client can judge rather than guess.
  co_location_count  int         not null default 0,
  branch_count       int         not null default 0,
  avg_rating         numeric(3,2),
  total_reviews      int         not null default 0,
  sample_place_ids   text[]      not null default '{}',
  cities             text[]      not null default '{}',

  -- How it relates to the client's own business.
  primary_type       text,
  same_category      boolean     not null default false,
  nearest_distance_m int,

  status             text        not null default 'suggested'
                     check (status in ('suggested','confirmed','rejected')),
  decided_at         timestamptz,

  discovered_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Re-running discovery must update a brand in place, never duplicate it.
  unique (brand_key)
);

create index if not exists cc_status_idx    on competitor_candidates (status);
create index if not exists cc_coloc_idx     on competitor_candidates (co_location_count desc);

-- What the new-analysis dropdown reads: confirmed brands, strongest first,
-- already formatted as the "Brand|alias|alias" string a job expects.
create or replace view competitor_confirmed as
select
  brand_key,
  brand_name,
  aliases,
  co_location_count,
  branch_count,
  avg_rating,
  total_reviews,
  array_to_string(
    array_prepend(brand_name, array_remove(aliases, brand_name)), '|'
  ) as job_value
from competitor_candidates
where status = 'confirmed';

grant select on competitor_confirmed to anon, authenticated, service_role;
grant select, insert, update, delete on competitor_candidates to anon, authenticated, service_role;

notify pgrst, 'reload schema';
