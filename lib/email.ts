/**
 * SMTP sender utility.
 */
import nodemailer from 'nodemailer';
import { getSettings } from './settings';

async function transporter(): Promise<nodemailer.Transporter> {
  const s = await getSettings();
  if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) {
    throw new Error('SMTP not configured. Visit /admin → SMTP to set credentials.');
  }

  return nodemailer.createTransport({
    host: s.smtp_host,
    port: s.smtp_port,
    secure: s.smtp_secure, // true for 465, false for other ports
    auth: {
      user: s.smtp_user,
      pass: s.smtp_pass,
    },
  });
}

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
  const s  = await getSettings();
  const tx = await transporter();
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
        <tr><td style="padding:6px 12px"><b>Reviews (3 months)</b></td>
            <td style="padding:6px 12px">${p.reviewsTotal}</td></tr>
      </table>
      <p style="color:#666;font-size:12px">Sent automatically — do not reply.</p>
    </div>`;

  await tx.sendMail({
    from: `"${s.smtp_from_name}" <${s.smtp_from_email || s.smtp_user}>`,
    to: p.to, 
    subject, 
    html,
    attachments: [
      { filename: 'analysis.xlsx', path: p.excelPath },
      { filename: 'report.md',     path: p.reportPath },
    ],
  });
}

export async function sendFailureEmail(to: string, targetName: string, errorMessage: string) {
  const s  = await getSettings();
  const tx = await transporter();
  await tx.sendMail({
    from: `"${s.smtp_from_name}" <${s.smtp_from_email || s.smtp_user}>`,
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
  const s  = await getSettings();
  const tx = await transporter();
  await tx.sendMail({
    from: `"${s.smtp_from_name}" <${s.smtp_from_email || s.smtp_user}>`,
    to,
    subject: 'Test email — Reviews Analytics',
    html: '<p>If you can read this, your SMTP configuration is working correctly.</p>',
  });
}

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}
