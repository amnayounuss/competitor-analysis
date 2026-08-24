import { adminClient } from './supabase';

export type NotificationKind =
  | 'job_succeeded' | 'job_failed' | 'email_sent' | 'job_started'
  // Client-actionable key problems: the run continued (with reduced data) but
  // the client has to replace a key before the next one.
  | 'ai_key_problem' | 'apify_key_problem';

export async function notify(args: {
  userId: string;
  jobId?: string;
  kind: NotificationKind;
  title: string;
  body?: string;
}) {
  const sb = adminClient();
  await sb.from('notifications').insert({
    user_id: args.userId,
    job_id: args.jobId,
    kind: args.kind,
    title: args.title,
    body: args.body,
  });
}
