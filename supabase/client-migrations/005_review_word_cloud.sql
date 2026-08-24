-- ============================================================
--  005_review_word_cloud.sql
--
--  Word-cloud source for the dashboard Overview tab: word frequencies
--  from the CLIENT's own customer reviews, split by review rating.
--
--    rating >= 4  → sentiment 'positive'
--    rating <= 2  → sentiment 'negative'
--    rating  = 3  → excluded (neutral)
--    rating IS NULL → excluded (Apify returned a date but no stars)
--
--  Competitors are excluded via branches.is_target — only the client's own
--  branches contribute.
--
--  This is a plain VIEW, not a materialized one: every review the pipeline
--  inserts from here on is picked up automatically, with no backfill and no
--  recompute step. Reviews are tokenised on the fly.
--
--  Both scripts are kept. An Arabic review carries Google's English
--  translation inside the same `text` column, so one review contributes both
--  its Arabic and its English words — matching the mixed-script reference UI.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

-- ── Stopwords ───────────────────────────────────────────────
-- Stored as a table rather than inlined in the view so the list can be tuned
-- (INSERT/DELETE) without recreating the view.
create table if not exists review_word_stopwords (
  word text primary key
);

-- Words are normalised before lookup (lower-cased, Arabic diacritics stripped,
-- أإآ→ا, ى→ي, ة→ه), so every entry below must already be in normalised form.
-- That is why the Arabic preposition "على" is listed as "علي".
insert into review_word_stopwords (word) values
  -- ── English function words ──
  ('the'),('and'),('for'),('was'),('with'),('you'),('that'),('this'),('have'),
  ('has'),('had'),('are'),('were'),('not'),('but'),('they'),('their'),('there'),
  ('from'),('out'),('all'),('any'),('just'),('very'),('too'),('also'),('get'),
  ('got'),('one'),('two'),('when'),('what'),('who'),('how'),('its'),('his'),
  ('her'),('them'),('she'),('our'),('been'),('will'),('would'),('can'),('could'),
  ('more'),('most'),('some'),('about'),('than'),('into'),('over'),('only'),
  ('other'),('which'),('here'),('then'),('because'),('while'),('after'),
  ('before'),('again'),('much'),('many'),('really'),('always'),('never'),
  ('ever'),('even'),('still'),('back'),('went'),('going'),('make'),('made'),
  ('like'),('know'),('think'),('say'),('said'),('see'),('saw'),('come'),('came'),
  ('take'),('took'),('give'),('gave'),('your'),('yours'),('mine'),('him'),
  ('why'),('way'),('yes'),('did'),('does'),('doing'),('done'),('being'),
  ('where'),('each'),('every'),('both'),('few'),('own'),('same'),('such'),
  ('once'),('nor'),('off'),('per'),('via'),('had'),('may'),('might'),('must'),
  ('shall'),('should'),('let'),('put'),('use'),('used'),('want'),('need'),
  ('feel'),('felt'),('look'),('looks'),('looked'),('seem'),('seems'),
  -- contraction fragments left behind by tokenising on apostrophes
  ('don'),('didn'),('doesn'),('isn'),('wasn'),('aren'),('weren'),('won'),
  ('couldn'),('shouldn'),('wouldn'),('haven'),('hasn'),('hadn'),('ain'),
  ('ive'),('dont'),('cant'),('till'),
  -- ── Google Maps / translation scaffolding ──
  ('google'),('translated'),('original'),('food'),('service'),('atmosphere'),
  ('order'),('type'),('dine'),('takeout'),('delivery'),('recommended'),
  ('dishes'),('price'),('person'),('meal'),('parking'),('space'),('options'),
  ('lot'),('wheelchair'),('accessible'),('spend'),('less'),('sar'),('riyal'),
  ('star'),('stars'),('review'),('reviews'),('rating'),
  -- ── Religious formulae that survive translation ("ما شاء الله" → "God willing") ──
  ('god'),('allah'),('willing'),('praise'),('mashallah'),('inshallah'),
  ('الله'),('ماشاءالله'),('بسمالله'),('الحمد'),
  -- ── The client's own brand name — it is in nearly every review and would
  --    dominate the cloud without describing anything.
  ('camel'),('step'),('steps'),('خطوه'),('جمل'),('الجمل'),('خطوة'),
  -- ── Arabic function words ──
  ('في'),('فى'),('من'),('علي'),('الي'),('عن'),('مع'),('هذا'),('هذه'),('ذلك'),
  ('التي'),('الذي'),('الذين'),('ان'),('كان'),('كانت'),('يكون'),('تكون'),
  ('كنت'),('كنا'),('لا'),('ما'),('او'),('كل'),('بعد'),('قبل'),('عند'),('عندي'),
  ('هو'),('هي'),('انا'),('انت'),('نحن'),('هم'),('هنا'),('هناك'),('جدا'),('بس'),
  ('يعني'),('كذا'),('شي'),('شيء'),('عليك'),('عليه'),('فيه'),('فيها'),('قد'),
  ('لكن'),('لكنه'),('لم'),('لن'),('اي'),('ايضا'),('حتي'),('ثم'),('بين'),('دون'),
  ('غير'),('سوف'),('ولا'),('لها'),('له'),('لي'),('لك'),('بها'),('به'),('منه'),
  ('منها'),('مره'),('والله'),('اللي'),('كثير'),('شوي'),('بشكل'),('بدون'),
  ('فقط'),('امس'),('اليوم'),('دايما'),('دائما'),('ابدا'),('حيث'),('لماذا'),
  ('كيف'),('ماذا'),('وهو'),('وهي'),('وان'),('واذا'),('اذا'),('ايش'),('وش'),
  ('هذي'),('هاذي'),('ذي'),('تم'),('يتم'),('عليها'),('كما'),('لقد'),('انها'),
  ('انه'),('اني'),('بان'),('حول'),('نفس'),('بعض'),('كانه'),('يوجد'),('مافيه'),
  ('عشان'),('لان'),('ولكن'),('واحد'),('اول'),('اخر'),('الان'),('كمان'),('برضو')
on conflict (word) do nothing;

-- ── The view ────────────────────────────────────────────────
create or replace view review_word_cloud as
with src as (
  select r.rating, r.text
  from reviews r
  join branches b on b.id = r.branch_id and b.is_target
  where btrim(coalesce(r.text, '')) <> ''
    and r.rating is not null
    and (r.rating >= 4 or r.rating <= 2)
    -- Owner/business replies live in the same column as customer reviews.
    -- They are the brand talking about itself, not customer voice.
    and r.text !~* 'we appreciate your feedback|your visit honors us|we look forward to seeing you|نتشرف بزيارت|شكرا لتقييم|نشكرك علي تقييم|نشكرك على تقييم'
),
cleaned as (
  select
    case when rating >= 4 then 'positive' else 'negative' end as sentiment,
    regexp_replace(
      regexp_replace(
        regexp_replace(text, '\(Translated by Google\)|\(Original\)|…\s*More', ' ', 'g'),
        '(Food|Service|Atmosphere|Order type|Price per person|Parking space|Parking options|Recommended dishes|Meal type|Dine in|Takeout|Delivery)\s*:?\s*[0-9]*',
        ' ', 'g'
      ),
      '[ًٌٍَُِّْـ]', '', 'g'          -- Arabic diacritics + tatweel
    ) as txt
  from src
),
tokens as (
  select
    sentiment,
    -- unify alef / ya / ta-marbuta variants so surface forms group together
    translate(lower(w), 'أإآىة', 'ااايه') as word
  from cleaned,
       regexp_split_to_table(txt, '[^a-zA-Z؀-ۿ]+') as w
  where length(w) >= 3
)
select
  t.sentiment,
  t.word,
  count(*)::int as freq
from tokens t
where not exists (
  select 1 from review_word_stopwords s where s.word = t.word
)
group by t.sentiment, t.word
having count(*) >= 3;

-- ── Grants + PostgREST exposure ─────────────────────────────
grant select on review_word_cloud   to anon, authenticated, service_role;
grant select on review_word_stopwords to anon, authenticated, service_role;

notify pgrst, 'reload schema';
