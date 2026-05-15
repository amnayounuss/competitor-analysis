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
  date_start?: string | null;
  date_end?: string | null;
  search_location?: string | null;
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

// ═══════════════════════════════════════════════════════════
//  Dashboard Data Interfaces
// ═══════════════════════════════════════════════════════════

/** Row from the branch_analytics table — maps to Branch Wise Data CSV */
export interface BranchAnalytics {
  id: string;
  job_id: string;
  branch_id: string | null;
  brand: string;
  branch_name: string;
  city: string | null;
  address: string | null;
  google_maps_link: string | null;
  business_hours: string | null;
  phone: string | null;
  peak_day: string | null;
  peak_hour: string | null;
  peak_busyness_pct: number | null;
  peak_time: string | null;
  busy_hours_summary: string | null;
  avg_rating_period: number | null;
  total_reviews_period: number;
  month_1_reviews: number;
  month_1_avg_rating: number | null;
  month_2_reviews: number;
  month_2_avg_rating: number | null;
  month_3_reviews: number;
  month_3_avg_rating: number | null;
  star_5_count: number;
  star_4_count: number;
  star_3_count: number;
  star_2_count: number;
  star_1_count: number;
  popular_times_grid: Record<string, (number | null)[]> | null;
  date_start: string | null;
  date_end: string | null;
}

/** Row from analyses table — maps to Brand Comparison CSV */
export interface Analysis {
  brand: string;
  branch_count: number;
  total_reviews_3m: number;
  avg_rating_3m: number;
  star_5_count: number;
  star_4_count: number;
  star_3_count: number;
  star_2_count: number;
  star_1_count: number;
}

/** Row from reviews table — maps to All Reviews CSV */
export interface Review {
  id: number;
  job_id?: string;
  brand: string;
  branch_id?: string | null;
  branch_name?: string | null;
  rating: number | null;
  text: string | null;
  reviewer_name: string | null;
  published_at: string | null;
}

/** Per-brand aggregated summary — computed client-side */
export interface BrandSummary {
  brand: string;
  isTarget: boolean;
  branches: number;
  totalReviews: number;
  avgRating: number | null;
  stars: [number, number, number, number, number];
  monthly: { reviews: number; avg: number | null }[];
  color: string;
}

/** Props for the individual job analysis dashboard */
export interface AnalysisDashboardProps {
  job: Job;
  data: {
    analytics: BranchAnalytics[];
    reviews: Review[];
    analyses: Analysis[];
  };
}

/** Props for the global dashboard view */
export interface GlobalDashboardProps {
  data: {
    analytics: BranchAnalytics[];
    analyses: Analysis[];
    targetBrand: string | null;
    competitorBrands: string[];
    jobId: string | null;
    dateStart: string | null;
    dateEnd: string | null;
    finishedAt: string | null;
  };
  allJobs: Job[];
}

/** Dynamic color palette for brands */
export const BRAND_PALETTE = [
  '#6366F1', '#10B981', '#F43F5E', '#F59E0B', '#0EA5E9',
  '#A855F7', '#EC4899', '#14B8A6', '#84CC16', '#F97316',
];

/** Star rating color map */
export const STAR_COLORS = ['#10B981', '#34D399', '#FBBF24', '#FB7185', '#F43F5E'];

/** Day constants for Popular Times */
export const DAYS_OF_WEEK = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
export const DAY_LABELS: Record<string, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
  THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat',
};
