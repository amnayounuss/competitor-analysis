-- ============================================================
--  008_review_word_cloud_by_job.sql
--
--  Per-job companion to review_word_cloud_ai.
--
--  The global view aggregates every labelled review in the schema, which is what
--  the dashboard Overview wants (it already combines all succeeded jobs). The
--  job detail page at /jobs/[id] shows one analysis, so it needs the same counts
--  scoped to that job — reviews carry job_id, so the grouping just adds it.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

create or replace view review_word_cloud_ai_by_job as
select
  r.job_id,
  w.sentiment,
  w.word,
  count(*)::int as freq
from review_ai_words w
join reviews r  on r.id = w.review_id
join branches b on b.id = r.branch_id and b.is_target
group by r.job_id, w.sentiment, w.word
having count(*) >= 2;

grant select on review_word_cloud_ai_by_job to anon, authenticated, service_role;

notify pgrst, 'reload schema';
