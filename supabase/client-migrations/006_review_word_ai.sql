-- ============================================================
--  006_review_word_ai.sql
--
--  AI-labelled word cloud source. Where migration 005 bucketed words by the
--  star rating of the review they appeared in, this one has Claude READ each
--  review and report which words carry positive sentiment and which carry
--  negative sentiment, in context.
--
--  Why that matters:
--    * a 5-star review can still contain a complaint ("great coffee, slow
--      cashier") — rating-bucketing files "slow" as positive
--    * neutral nouns (place, branch, employee, coffee) appeared in BOTH clouds
--      under rating-bucketing; AI labelling drops them entirely
--    * context disambiguates: "cold" is negative for coffee, neutral in
--      "cold brew"
--
--  Only the client's own reviews are read — branches.is_target = true, which is
--  exactly the set fetched from the Google Business Profile API (competitor
--  reviews come from Apify and are excluded).
--
--  Population is done by scripts/ai-review-words.mjs, which is incremental:
--  it only sends reviews absent from review_ai_processed, so re-running after
--  a new analysis job costs only the new reviews.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

-- One row per (review, word) that Claude labelled as carrying sentiment.
create table if not exists review_ai_words (
  id         bigserial primary key,
  review_id  bigint      not null references reviews(id) on delete cascade,
  word       text        not null,
  sentiment  text        not null check (sentiment in ('positive', 'negative')),
  created_at timestamptz not null default now(),
  unique (review_id, word, sentiment)
);

create index if not exists review_ai_words_sentiment_idx on review_ai_words (sentiment);
create index if not exists review_ai_words_word_idx      on review_ai_words (word);

-- Marks a review as read, including reviews that yielded no sentiment words at
-- all. Without this the extractor would re-send empty reviews on every run.
create table if not exists review_ai_processed (
  review_id   bigint      primary key references reviews(id) on delete cascade,
  word_count  int         not null default 0,
  processed_at timestamptz not null default now()
);

-- ── The view the dashboard reads ────────────────────────────
-- Frequencies are computed live, so they stay correct as rows are added.
create or replace view review_word_cloud_ai as
select
  w.sentiment,
  w.word,
  count(*)::int as freq
from review_ai_words w
join reviews r  on r.id = w.review_id
join branches b on b.id = r.branch_id and b.is_target
group by w.sentiment, w.word
having count(*) >= 2;

grant select on review_word_cloud_ai to anon, authenticated, service_role;
grant select, insert, update, delete on review_ai_words     to service_role;
grant select, insert, update, delete on review_ai_processed to service_role;
grant usage, select on sequence review_ai_words_id_seq      to service_role;

notify pgrst, 'reload schema';
