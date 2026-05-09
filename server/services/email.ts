import { Resend } from "resend";
import type {
  Bill,
  ClientImpactAnalysis,
  Client,
  LawVersion,
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

async function send(opts: {
  subject: string;
  html: string;
}): Promise<EmailResult> {
  const client = getClient();
  const to = process.env.NOTIFY_EMAIL || "lawyer@example.com";
  const from = process.env.RESEND_FROM || "RegDelta <onboarding@resend.dev>";

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
    html: `<p>A new bill has been uploaded to RegDelta.</p>
      <p><b>${bill.billNumber}</b> — ${bill.title}<br/>
      Status: ${bill.status}<br/>
      Legislative momentum: ${bill.legislativeMomentum}</p>
      <p>Open Delta Workspace to review the proposed legal delta.</p>`,
  });
}

export async function sendBillPassedEmail(bill: Bill): Promise<EmailResult> {
  return send({
    subject: `[Bill Status] ${bill.billNumber} — ${bill.status}`,
    html: `<p>${bill.billNumber} status changed: <b>${bill.status}</b>. Re-review the linked LawVersion if needed.</p>`,
  });
}

export async function sendClientImpactCompleteEmail(args: {
  analysis: ClientImpactAnalysis;
  client: Client;
  lawVersion: LawVersion;
}): Promise<EmailResult> {
  const { analysis: a, client, lawVersion: lv } = args;
  return send({
    subject: `[Client Impact Ready] ${client.name} analysis completed for ${lv.sourceBillNumber}`,
    html: `<p><b>${client.name}</b> analysis for <b>${lv.sourceBillNumber}</b> — ${lv.sourceBillTitle}</p>
      <ul>
        <li>Affected: <b>${a.affected}</b></li>
        <li>Impact level: <b>${a.impactLevel}</b></li>
        <li>Urgency: <b>${a.urgency}</b></li>
        <li>Timing: ${a.timing}</li>
      </ul>
      <p><b>Why it matters:</b> ${a.whyItAffectsClient}</p>
      <p>Open the Client Impact Analysis page in RegDelta to review and act.</p>`,
  });
}

export function simulateEmailIfMissingKey(): boolean {
  return !process.env.RESEND_API_KEY;
}
