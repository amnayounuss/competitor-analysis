-- Dashboard advisor: complaint topics, and one daily fact view behind every
-- section of it.
--
-- The advisor has to answer "what changed since last period" for a dozen
-- different measures. Querying `reviews` directly for each one meant pulling the
-- whole corpus into the API on every page load, so everything now derives from a
-- single pre-aggregated row per (branch, day): KPIs, the positive/neutral/
-- negative split, the 1-5 star distribution, the trend, reply performance and
-- the per-branch tables all read the same rows and therefore cannot disagree.
--
-- Topics live on the review itself because one comment routinely raises several
-- ("cold food and the waiter was rude"), and a single-topic column would throw
-- half of every such complaint away.

alter table if exists reviews add column if not exists topics      text[];
alter table if exists reviews add column if not exists topic_model  text;
alter table if exists reviews add column if not exists topic_at     timestamptz;

create index if not exists reviews_topics_idx on reviews using gin (topics);

-- Band cutoffs match migration 011 and the sentiment spec: <=40 negative,
-- 41-60 neutral, >=61 positive. Kept in one place so a chart can never draw a
-- different line from the one the AI is told about.
create or replace view review_daily_facts as
select
  r.brand,
  r.branch_id,
  b.branch_name,
  b.city,
  (r.published_at)::date                                            as day,
  count(*)                                                          as reviews,
  count(r.sentiment_score)                                          as scored,
  avg(r.sentiment_score)                                            as avg_sentiment,
  avg(r.rating::numeric)                                            as avg_rating,
  count(*) filter (where r.rating = 1)                              as stars_1,
  count(*) filter (where r.rating = 2)                              as stars_2,
  count(*) filter (where r.rating = 3)                              as stars_3,
  count(*) filter (where r.rating = 4)                              as stars_4,
  count(*) filter (where r.rating = 5)                              as stars_5,
  count(*) filter (where r.sentiment_score <= 40)                   as negative,
  count(*) filter (where r.sentiment_score between 41 and 60)       as neutral,
  count(*) filter (where r.sentiment_score >= 61)                   as positive,
  count(r.replied_at)                                               as replied,
  count(*) filter (where r.sentiment_score <= 40
                     and r.replied_at is null)                      as negative_unanswered,
  -- Summed, not averaged: averaging an average across days would weight a
  -- quiet day the same as a busy one.
  sum(extract(epoch from (r.replied_at - r.published_at)) / 3600.0)
    filter (where r.replied_at is not null
              and r.replied_at >= r.published_at)                   as reply_hours_sum,
  count(*) filter (where r.replied_at is not null
                     and r.replied_at >= r.published_at)            as reply_hours_n
from reviews r
join branches b on b.id = r.branch_id
where b.is_target = true
  and r.published_at is not null
group by r.brand, r.branch_id, b.branch_name, b.city, (r.published_at)::date;

-- One row per (review, topic). Carries the date, rating and sentiment so a
-- topic's volume, severity and change over a period all come from here.
create or replace view review_topic_rows as
select
  r.id                          as review_id,
  r.brand,
  r.branch_id,
  b.branch_name,
  (r.published_at)::date        as day,
  r.rating,
  r.sentiment_score,
  t.topic
from reviews r
join branches b on b.id = r.branch_id
cross join lateral unnest(coalesce(r.topics, '{}'::text[])) as t(topic)
where b.is_target = true
  and r.published_at is not null;

-- Views are created owned by the migration role, so PostgREST's roles cannot
-- read them until they are granted. Without this the dashboard answers
-- "permission denied for view" and looks like a missing table.
grant select on review_daily_facts, review_topic_rows to anon, authenticated, service_role;
