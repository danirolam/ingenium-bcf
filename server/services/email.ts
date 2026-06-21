import { Resend } from "resend";
import type {
  Bill,
  ClientImpactAnalysis,
  Client,
} from "../../src/types.js";

export type EmailResult = { sent: boolean; simulated: boolean; info?: string };

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    return new Resend(key);
  } catch {
    return null;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function send(opts: {
  subject: string;
  html: string;
  to?: string;
}): Promise<EmailResult> {
  const client = getClient();
  const to = opts.to || process.env.NOTIFY_EMAIL || "lawyer@example.com";
  const from = process.env.RESEND_FROM || "Ingenium <onboarding@resend.dev>";

  if (!client) {
    console.log(`[email] simulated → ${to} :: ${opts.subject}`);
    return { sent: false, simulated: true, info: "Email simulated." };
  }

  try {
    await client.emails.send({
      from,
      to,
      subject: opts.subject,
      html: opts.html,
    });
    return { sent: true, simulated: false };
  } catch (err: any) {
    console.log(`[email] send failed (${err?.message}) — simulating`);
    return { sent: false, simulated: true, info: "Email simulated." };
  }
}

export async function sendBillUploadedEmail(bill: Bill): Promise<EmailResult> {
  return send({
    subject: `[New Bill Uploaded] ${bill.billNumber} is ready for legal delta review`,
    html: `<p>A new bill has been uploaded to Ingenium.</p>
      <p><b>${bill.billNumber}</b>: ${bill.title}<br/>
      Status: ${bill.status}<br/>
      Legislative momentum: ${bill.legislativeMomentum}</p>
      <p>Open Delta Workspace to review the proposed legal delta.</p>`,
  });
}

export async function sendBillPassedEmail(bill: Bill): Promise<EmailResult> {
  return send({
    subject: `[Bill Status] ${bill.billNumber}: ${bill.status}`,
    html: `<p>${bill.billNumber} status changed: <b>${bill.status}</b>. Re-review the linked LawVersion if needed.</p>`,
  });
}

export async function sendClientImpactCompleteEmail(args: {
  analysis: ClientImpactAnalysis;
  client: Client;
  bill: Bill;
}): Promise<EmailResult> {
  const { analysis: a, client, bill } = args;
  return send({
    subject: `[Client Impact Ready] ${client.name} analysis completed for ${bill.billNumber}`,
    html: `<p><b>${client.name}</b> analysis for <b>${bill.billNumber}</b>: ${bill.title}</p>
      <ul>
        <li>Affected: <b>${a.affected}</b></li>
        <li>Impact level: <b>${a.impactLevel}</b></li>
        <li>Urgency: <b>${a.urgency}</b></li>
        <li>Timing: ${a.timing}</li>
      </ul>
      <p><b>Why it matters:</b> ${a.whyItAffectsClient}</p>
      <p>Open the Client Impact Analysis page in Ingenium to review and act.</p>`,
  });
}

/**
 * The CLIENT-facing email: the counsel-approved draft, addressed to the client.
 * For the demo every message routes to one inbox (CLIENT_EMAIL falls back to
 * NOTIFY_EMAIL); in production CLIENT_EMAIL would be the client contact. The
 * draft body is plain text — render it as clean paragraphs, not a code block.
 */
export async function sendClientBriefEmail(args: {
  client: Client;
  bill: Bill;
  draft: { subject: string; body: string };
}): Promise<EmailResult> {
  const html = args.draft.body
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 14px;line-height:1.65">${escapeHtml(para.trim()).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  return send({
    to: process.env.CLIENT_EMAIL || process.env.NOTIFY_EMAIL || "client@example.com",
    subject: args.draft.subject,
    html: `<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1a1a1a;max-width:560px;margin:0 auto">${html}</div>`,
  });
}

export function simulateEmailIfMissingKey(): boolean {
  return !process.env.RESEND_API_KEY;
}
