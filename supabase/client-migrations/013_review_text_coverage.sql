-- Separate "nothing to read" from "not read yet".
--
-- A star-only review carries no words, so it can never have a feeling score.
-- Counting it as unread told the client 1,080 reviews were waiting for the AI
-- when only 12 actually were, and sent them chasing a figure that can never
-- reach 100%.

-- A replace cannot insert a column mid-list, so the view is rebuilt. Nothing
-- depends on it (review_topic_rows reads `reviews` directly), so this is safe.
drop view if exists review_daily_facts;

create view review_daily_facts as
select
  r.brand,
  r.branch_id,
  b.branch_name,
  b.city,
  (r.published_at)::date                                            as day,
  count(*)                                                          as reviews,
  count(*) filter (where coalesce(btrim(r.text), '') <> '')         as with_text,
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

grant select on review_daily_facts to anon, authenticated, service_role;
