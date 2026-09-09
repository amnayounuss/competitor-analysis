-- ============================================================
--  010_branch_health.sql
--
--  Backing store and views for the Branch Health module.
--
--  Three things the reviews table did not carry:
--
--    reply_text / replied_at
--      The Business Profile reviews API returns reviewReply.comment and
--      reviewReply.updateTime, and the pipeline was discarding both. They are
--      what reply rate and response time are computed from — 6 of 8 sampled
--      reviews had a reply, so this is real signal, not a rare field.
--
--    sentiment_score
--      A 0-100 judgement of the review text, written by whichever AI provider
--      the client configured. Stars and sentiment disagree often enough to be
--      worth showing side by side: a 4-star review that reads as a complaint is
--      the case a rating average hides.
--
--    sentiment_model
--      Which model produced the score. Scores from different models are not
--      strictly comparable, so the provenance travels with the number.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

alter table reviews
  add column if not exists reply_text      text,
  add column if not exists replied_at      timestamptz,
  add column if not exists sentiment_score int,
  add column if not exists sentiment_model text,
  add column if not exists sentiment_at    timestamptz;

alter table reviews
  drop constraint if exists reviews_sentiment_score_check;
alter table reviews
  add constraint reviews_sentiment_score_check
  check (sentiment_score is null or sentiment_score between 0 and 100);

create index if not exists reviews_sentiment_idx on reviews (sentiment_score);
create index if not exists reviews_replied_idx   on reviews (replied_at);

comment on column reviews.sentiment_score is
  '0-100 sentiment of the review text, from the client''s configured AI provider. NULL means not yet scored.';
comment on column reviews.replied_at is
  'When the owner replied (reviewReply.updateTime). NULL means no reply.';

-- ── Per-review base, scoped to the client's own branches ────
-- Every view below builds on this, so the is_target filter and the reply/stars
-- derivations live in exactly one place.
create or replace view review_intelligence as
select
  r.id,
  r.job_id,
  r.branch_id,
  r.brand,
  coalesce(b.branch_name, '(unknown)') as branch_name,
  b.city,
  r.rating,
  r.sentiment_score,
  r.sentiment_model,
  r.text,
  r.published_at,
  r.replied_at,
  r.reply_text is not null and btrim(r.reply_text) <> ''      as has_reply,
  -- Hours between the review and the reply. Only meaningful when replied.
  case when r.replied_at is not null and r.published_at is not null
       then round(extract(epoch from (r.replied_at - r.published_at)) / 3600.0, 1)
  end                                                         as reply_hours,
  -- Stars on the same 0-100 scale as sentiment, so the two can be compared.
  case when r.rating is not null then (r.rating - 1) * 25 end as rating_scaled,
  case
    when r.sentiment_score is null then null
    when r.sentiment_score >= 70 then 'positive'
    when r.sentiment_score >= 40 then 'neutral'
    else 'negative'
  end                                                         as sentiment_band
from reviews r
join branches b on b.id = r.branch_id and b.is_target;

grant select on review_intelligence to anon, authenticated, service_role;

-- ── Daily trend: average sentiment and volume ──────────────
create or replace view review_sentiment_daily as
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

grant select on review_sentiment_daily to anon, authenticated, service_role;

-- ── Per-branch rollup, plus the health score ───────────────
-- Weights are the module's: 55% sentiment, 20% reply rate, 15% rating, 10% volume.
-- Volume is scaled against the busiest branch in the same brand rather than an
-- absolute target — "busy" only means anything relative to your other branches.
create or replace view branch_health as
with base as (
  select
    brand,
    branch_id,
    branch_name,
    city,
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
  group by brand, branch_id, branch_name, city
),
scaled as (
  select *,
    -- Busiest branch of the same brand = 100 on the volume component.
    round(100.0 * reviews / nullif(max(reviews) over (partition by brand), 0), 1) as volume_score
  from base
)
select
  brand, branch_id, branch_name, city,
  reviews, scored_reviews,
  avg_sentiment, avg_rating, avg_rating_scaled,
  reply_rate, avg_reply_hours, volume_score,
  -- Components are coalesced so a branch with no replies scores zero on that
  -- part rather than dropping out of the ranking entirely.
  round(
      0.55 * coalesce(avg_sentiment, avg_rating_scaled, 0)
    + 0.20 * coalesce(reply_rate, 0)
    + 0.15 * coalesce(avg_rating_scaled, 0)
    + 0.10 * coalesce(volume_score, 0)
  , 1) as health_score,
  first_review, last_review
from scaled;

grant select on branch_health to anon, authenticated, service_role;

-- ── Sentiment mix: share of reviews per band ───────────────
create or replace view review_sentiment_mix as
select
  brand,
  branch_id,
  sentiment_band,
  count(*)::int as reviews,
  round(100.0 * count(*) / nullif(sum(count(*)) over (partition by brand, branch_id), 0), 1) as share_pct
from review_intelligence
where sentiment_band is not null
group by brand, branch_id, sentiment_band;

grant select on review_sentiment_mix to anon, authenticated, service_role;

notify pgrst, 'reload schema';
