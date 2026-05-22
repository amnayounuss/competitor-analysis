/**
 * Resend Email Delivery Engine.
 */
import { Resend } from 'resend';
import fs from 'fs';

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured in your environment variables.');
  }
  return new Resend(apiKey);
}

const DEFAULT_SENDER = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

export interface ReportEmailParams {
  to: string;
  targetName: string;
  competitors: string[];
  branchesTotal: number;
  reviewsTotal: number;
  excelPath: string;
  reportPath: string;
}

export async function sendReportEmail(p: ReportEmailParams) {
  const resend = getResendClient();
  const subject = `Google Reviews Report — ${p.targetName} vs ${p.competitors.join(', ')}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6">
      <h2 style="color:#1a1a1a">Your competitor analysis is ready</h2>
      <p>The analysis for <b>${esc(p.targetName)}</b> has finished. Excel and Markdown summary attached.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;background:#f5f5f5"><b>Target</b></td>
            <td style="padding:6px 12px;background:#f5f5f5">${esc(p.targetName)}</td></tr>
        <tr><td style="padding:6px 12px"><b>Competitors</b></td>
            <td style="padding:6px 12px">${p.competitors.map(esc).join(', ')}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5"><b>Branches</b></td>
            <td style="padding:6px 12px;background:#f5f5f5">${p.branchesTotal}</td></tr>
        <tr><td style="padding:6px 12px"><b>Reviews</b></td>
            <td style="padding:6px 12px">${p.reviewsTotal}</td></tr>
      </table>
      <p style="color:#666;font-size:12px">Sent automatically — do not reply.</p>
    </div>`;

  const excelContent = fs.readFileSync(p.excelPath);
  const reportContent = fs.readFileSync(p.reportPath);

  await resend.emails.send({
    from: DEFAULT_SENDER,
    to: p.to,
    subject,
    html,
    attachments: [
      { filename: 'analysis.xlsx', content: excelContent },
      { filename: 'report.md',     content: reportContent },
    ],
  });
}

export async function sendFailureEmail(to: string, targetName: string, errorMessage: string) {
  const resend = getResendClient();
  await resend.emails.send({
    from: DEFAULT_SENDER,
    to,
    subject: `Analysis failed — ${targetName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px">
        <h2 style="color:#c00">Analysis failed</h2>
        <p>The analysis for <b>${esc(targetName)}</b> could not complete.</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">${esc(errorMessage)}</pre>
      </div>`,
  });
}

export async function sendTestEmail(to: string) {
  const resend = getResendClient();
  await resend.emails.send({
    from: DEFAULT_SENDER,
    to,
    subject: 'Test email — Reviews Analytics',
    html: '<p>If you can read this, your Resend configuration is working correctly.</p>',
  });
}

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

export interface ResendFromStorageParams {
  to: string;
  targetName: string;
  competitors: string[];
  branchesTotal: number;
  reviewsTotal: number;
  excelBuffer: Buffer;
  reportBuffer: Buffer;
}

export async function sendReportEmailWithBuffers(p: ResendFromStorageParams) {
  const resend = getResendClient();
  const subject = `Google Reviews Report — ${p.targetName} vs ${p.competitors.join(', ')}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6">
      <h2 style="color:#1a1a1a">Your competitor analysis is ready</h2>
      <p>The analysis for <b>${esc(p.targetName)}</b> has finished. Excel and Markdown summary attached.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;background:#f5f5f5"><b>Target</b></td>
            <td style="padding:6px 12px;background:#f5f5f5">${esc(p.targetName)}</td></tr>
        <tr><td style="padding:6px 12px"><b>Competitors</b></td>
            <td style="padding:6px 12px">${p.competitors.map(esc).join(', ')}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5"><b>Branches</b></td>
            <td style="padding:6px 12px;background:#f5f5f5">${p.branchesTotal}</td></tr>
        <tr><td style="padding:6px 12px"><b>Reviews</b></td>
            <td style="padding:6px 12px">${p.reviewsTotal}</td></tr>
      </table>
      <p style="color:#666;font-size:12px">Sent automatically — do not reply.</p>
    </div>`;

  const cleanFilename = p.targetName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  await resend.emails.send({
    from: DEFAULT_SENDER,
    to: p.to,
    subject,
    html,
    attachments: [
      { filename: `${cleanFilename}_analysis.xlsx`, content: p.excelBuffer },
      { filename: `${cleanFilename}_report.md`,     content: p.reportBuffer },
    ],
  });
}

