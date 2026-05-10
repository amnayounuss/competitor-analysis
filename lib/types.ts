export type JobStatus = 'queued'|'running'|'succeeded'|'failed'|'cancelled';
export type JobKind   = 'manual'|'scheduled';

export interface Job {
  id: string;
  user_id: string;
  kind: JobKind;
  schedule_id: string | null;
  target_name: string;
  competitors: string[];
  refresh_token: string;
  email_to: string;
  status: JobStatus;
  progress_pct: number;
  current_stage: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  excel_url: string | null;
  report_url: string | null;
  branches_total: number | null;
  reviews_total: number | null;
}

export interface Schedule {
  id: string;
  user_id: string;
  enabled: boolean;
  target_name: string;
  competitors: string[];
  refresh_token: string;
  email_to: string;
  day_of_month: number;
  next_run_at: string;
  last_run_at: string | null;
  last_job_id: string | null;
}

export interface Notification {
  id: number;
  user_id: string;
  job_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}
