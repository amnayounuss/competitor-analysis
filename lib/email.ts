/**
 * Gmail sender via OAuth2.
 *
 * We exchange the saved refresh_token for a short-lived access_token and use it
 * with nodemailer's Gmail OAuth2 flow. Refresh tokens last ~6 months in test mode
 * and don't expire when the OAuth app is in "production" mode (Google's terms).
 */
import nodemailer from 'nodemailer';
import { getSettings } from './settings';

interface AccessTokenCache {
  token: string;
  expiresAt: number;
  forKey: string;
}
let accessCache: AccessTokenCache | null = null;

/**
 * Refresh-token → access-token exchange.
 * Cached for the lifetime of the access token (1 hour) minus 60s buffer.
 */
async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const cacheKey = `${clientId}:${refreshToken}`;
  if (accessCache && accessCache.forKey === cacheKey && Date.now() < accessCache.expiresAt) {
    return accessCache.token;
  }

  const params = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gmail OAuth refresh failed (${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error('Gmail OAuth response missing access_token');

  accessCache = {
    token: json.access_token,
    expiresAt: Date.now() + ((json.expires_in || 3600) - 60) * 1000,
    forKey: cacheKey,
  };
  return json.access_token;
}

async function transporter(): Promise<nodemailer.Transporter> {
  const s = await getSettings();
  if (!s.gmail_user || !s.gmail_oauth_client_id || !s.gmail_oauth_client_secret || !s.gmail_refresh_token) {
    throw new Error('Gmail OAuth not configured. Visit /admin → Gmail to set credentials.');
  }

  const accessToken = await getAccessToken(
    s.gmail_oauth_client_id,
    s.gmail_oauth_client_secret,
    s.gmail_refresh_token,
  );

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user:         s.gmail_user,
      clientId:     s.gmail_oauth_client_id,
      clientSecret: s.gmail_oauth_client_secret,
      refreshToken: s.gmail_refresh_token,
      accessToken,
    },
  } as any);
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
    from: `"${s.gmail_from_name}" <${s.gmail_user}>`,
    to: p.to, subject, html,
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
    from: `"${s.gmail_from_name}" <${s.gmail_user}>`,
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
    from: `"${s.gmail_from_name}" <${s.gmail_user}>`,
    to,
    subject: 'Test email — Reviews Analytics',
    html: '<p>If you can read this, your Gmail OAuth is working.</p>',
  });
}

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}
