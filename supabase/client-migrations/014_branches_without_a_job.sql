-- Let a branch exist without an analysis job.
--
-- Migration 011 made reviews.job_id nullable for the standalone review sync but
-- left branches.job_id NOT NULL. Existing clients never noticed: their branches
-- had already been created by an analysis run, so a sync only ever updated
-- them. The very first sync for a brand-new client takes the insert path
-- instead, and every one of its 29 locations was rejected — reported as
-- "0 new reviews" rather than as a failure.

alter table if exists branches
  alter column job_id drop not null;
