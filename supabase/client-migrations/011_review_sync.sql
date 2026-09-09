-- ============================================================
--  011_review_sync.sql
--
--  Makes reviews re-fetchable, and lets one client hold several brands.
--
--  gmb_review_id
--    Reviews were keyed only by a bigserial, so re-fetching a location created
--    a second copy of every review. Google's own reviewId is stable, so it
--    becomes the natural key for an upsert and a sync can run as often as you
--    like without duplicating anything.
--
--  job_id becomes nullable
--    Reviews arrived only as part of an analysis job. Keeping the review corpus
--    current should not require running a full competitor analysis, so a
--    standalone sync writes rows with no job attached.
--
--  branches.gmb_review_sync_at / review_total
--    What Google reports as the location's own review count, and when the sync
--    last ran. Comparing that number against the rows actually stored is how a
--    partial fetch is spotted, rather than assuming success.
--
--  Multiple brands per client
--    A Business Profile account can manage unrelated businesses — this client's
--    holds White Cafe (15 locations), BRGR (9), CodeCo and Munch Burger. The
--    pipeline stamped all of them with the job's single target_name, so a café
--    and a burger chain averaged together into one meaningless "brand". The
--    store name Google returns per location is the truthful brand, so it gets
--    its own column and the views group on it.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

alter table reviews
  add column if not exists gmb_review_id text;

alter table reviews
  alter column job_id drop not null;

-- One row per Google review per branch.
--
-- Deliberately NOT a partial index: ON CONFLICT cannot target one, so an upsert
-- against a partial index fails with "no unique or exclusion constraint matching
-- the ON CONFLICT specification". A plain unique index is safe here anyway,
-- because Postgres treats NULLs as distinct in a unique index — the rows that
-- predate this column, which all have gmb_review_id NULL, do not collide.
drop index if exists reviews_gmb_review_uidx;
create unique index if not exists reviews_gmb_review_uidx
  on reviews (branch_id, gmb_review_id);

alter table branches
  add column if not exists brand_key      text,
  add column if not exists review_total   int,
  add column if not exists reviews_synced_at timestamptz;

comment on column reviews.gmb_review_id is
  'Google''s own reviewId. The upsert key for syncing, so a re-fetch updates rather than duplicates.';
comment on column branches.brand_key is
  'Normalised brand, derived from the Google store name. A single client account can manage several unrelated brands; job.target_name cannot represent that.';
comment on column branches.review_total is
  'totalReviewCount as Google reports it, for comparison against the rows actually stored.';

create index if not exists branches_brand_key_idx on branches (brand_key);

-- Brand falls back through: explicit brand_key, then the store name, then the
-- job's target name — so this works before and after a sync has run.
--
-- The whole view stack is dropped and rebuilt rather than replaced in place:
-- CREATE OR REPLACE VIEW can only append columns, and store_name belongs beside
-- the other branch fields, not bolted on the end. branch_health,
-- review_sentiment_daily and review_sentiment_mix all read this view, so they
-- come down with it and are recreated below in dependency order.
drop view if exists branch_health cascade;
drop view if exists review_sentiment_daily cascade;
drop view if exists review_sentiment_mix cascade;
drop view if exists review_intelligence cascade;

create view review_intelligence as
select
  r.id,
  r.job_id,
  r.branch_id,
  coalesce(nullif(btrim(b.brand_key), ''), nullif(btrim(b.store_name), ''), r.brand) as brand,
  coalesce(b.branch_name, '(unknown)')          as branch_name,
  b.city,
  b.store_name,
  r.rating,
  r.sentiment_score,
  r.sentiment_model,
  r.text,
  r.published_at,
  r.replied_at,
  r.reply_text is not null and btrim(r.reply_text) <> ''      as has_reply,
  case when r.replied_at is not null and r.published_at is not null
       then round(extract(epoch from (r.replied_at - r.published_at)) / 3600.0, 1)
  end                                                         as reply_hours,
  case when r.rating is not null then (r.rating - 1) * 25 end as rating_scaled,
  -- The five bands the brief specifies.
  case
    when r.sentiment_score is null then null
    when r.sentiment_score <= 20 then 'very_negative'
    when r.sentiment_score <= 40 then 'negative'
    when r.sentiment_score <= 60 then 'neutral'
    when r.sentiment_score <= 80 then 'positive'
    else 'very_positive'
  end                                                         as sentiment_band
from reviews r
join branches b on b.id = r.branch_id and b.is_target;

create view review_sentiment_daily as
select
  brand,
  branch_id,
  published_at::date              as day,
  count(*)::int                   as reviews,
  round(avg(sentiment_score), 1)  as avg_sentiment,
  round(avg(rating_scaled), 1)    as avg_rating_scaled
from review_intelligence
where published_at is not null
group by brand, branch_id, published_at::date;

create view review_sentiment_mix as
select
  brand,
  branch_id,
  sentiment_band,
  count(*)::int as reviews,
  round(100.0 * count(*) / nullif(sum(count(*)) over (partition by brand, branch_id), 0), 1) as share_pct
from review_intelligence
where sentiment_band is not null
group by brand, branch_id, sentiment_band;

create view branch_health as
with base as (
  select
    brand, branch_id, branch_name, city, store_name,
    count(*)::int                                            as reviews,
    round(avg(sentiment_score), 1)                           as avg_sentiment,
    round(avg(rating), 2)                                    as avg_rating,
    round(avg(rating_scaled), 1)                             as avg_rating_scaled,
    round(100.0 * count(*) filter (where has_reply) / nullif(count(*), 0), 1) as reply_rate,
    round(avg(reply_hours) filter (where has_reply), 1)      as avg_reply_hours,
    count(*) filter (where sentiment_score is not null)::int as scored_reviews,
    min(published_at)                                        as first_review,
    max(published_at)                                        as last_review
  from review_intelligence
  group by brand, branch_id, branch_name, city, store_name
),
scaled as (
  select *,
    round(100.0 * reviews / nullif(max(reviews) over (partition by brand), 0), 1) as volume_score
  from base
)
select
  brand, branch_id, branch_name, city, store_name,
  reviews, scored_reviews,
  avg_sentiment, avg_rating, avg_rating_scaled,
  reply_rate, avg_reply_hours, volume_score,
  round(
      0.55 * coalesce(avg_sentiment, avg_rating_scaled, 0)
    + 0.20 * coalesce(reply_rate, 0)
    + 0.15 * coalesce(avg_rating_scaled, 0)
    + 0.10 * coalesce(volume_score, 0)
  , 1) as health_score,
  first_review, last_review
from scaled;

grant select on review_intelligence, review_sentiment_daily, review_sentiment_mix, branch_health
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
