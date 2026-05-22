import { NextRequest, NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { sendReportEmailWithBuffers } from '@/lib/email';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = adminClient();

  // 1. Fetch the job and verify ownership
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: 'Job not found or access denied.' }, { status: 404 });
  }

  if (!job.excel_url || !job.report_url) {
    return NextResponse.json({
      error: 'Report files are not ready or were not generated. Cannot send email.'
    }, { status: 400 });
  }

  // 2. Parse request payload
  let emailTo = job.email_to;
  try {
    const body = await req.json();
    if (body.email && typeof body.email === 'string' && body.email.trim()) {
      emailTo = body.email.trim();
    }
  } catch (err) {}

  if (!emailTo) {
    return NextResponse.json({ error: 'No recipient email address specified.' }, { status: 400 });
  }

  try {
    // 3. Log start in job logs
    await admin.from('job_logs').insert({
      job_id: job.id,
      level: 'info',
      message: `Triggered manual report resend to: ${emailTo}`,
    });

    // 4. Download report files from Storage via public URLs
    console.log(`[resend-email] Downloading files for job ${job.id}...`);
    const [excelRes, reportRes] = await Promise.all([
      fetch(job.excel_url),
      fetch(job.report_url)
    ]);

    if (!excelRes.ok || !reportRes.ok) {
      throw new Error(`Failed to download report files from storage (Excel: ${excelRes.status}, Markdown: ${reportRes.status})`);
    }

    const [excelBuf, reportBuf] = await Promise.all([
      excelRes.arrayBuffer(),
      reportRes.arrayBuffer()
    ]);

    // 5. Send report email
    console.log(`[resend-email] Sending report email via Resend to ${emailTo}...`);
    await sendReportEmailWithBuffers({
      to: emailTo,
      targetName: job.target_name,
      competitors: Array.isArray(job.competitors) ? job.competitors : [],
      branchesTotal: job.branches_total || 0,
      reviewsTotal: job.reviews_total || 0,
      excelBuffer: Buffer.from(excelBuf),
      reportBuffer: Buffer.from(reportBuf)
    });

    // 6. Log success in job logs
    await admin.from('job_logs').insert({
      job_id: job.id,
      level: 'info',
      message: `Successfully resent report email to: ${emailTo}`,
    });

    return NextResponse.json({
      success: true,
      message: `Report email successfully resent to ${emailTo}`
    });

  } catch (err: any) {
    console.error('[resend-email] Error resending email:', err);
    
    // Log failure in job logs
    await admin.from('job_logs').insert({
      job_id: job.id,
      level: 'error',
      message: `Failed to resend report email: ${err.message}`,
    });

    return NextResponse.json({
      error: `Failed to resend email: ${err.message}`
    }, { status: 500 });
  }
}
