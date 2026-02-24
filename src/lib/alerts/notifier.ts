import type { TriggeredAlert } from "./evaluator.js";

export async function sendNotifications(alerts: TriggeredAlert[]): Promise<void> {
  // Only notify on NEW alerts — deduped alerts just increment count
  const newAlerts = alerts.filter((a) => a.isNew);
  if (newAlerts.length === 0) return;

  for (const alert of newAlerts) {
    try {
      switch (alert.notifyType) {
        case "webhook":
          await sendWebhook(alert);
          break;
        case "email":
          await sendEmail(alert);
          break;
        default:
          console.error(`[notify] Unknown type: ${alert.notifyType}`);
      }
    } catch (e: any) {
      console.error(`[notify] Failed to send ${alert.notifyType} for rule ${alert.ruleName}:`, e.message);
    }
  }
}

async function sendWebhook(alert: TriggeredAlert): Promise<void> {
  const payload = {
    text: alert.message,
    // Teams/Slack adaptive format
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", text: "🛡️ Security Alert", weight: "Bolder", size: "Medium" },
          { type: "TextBlock", text: alert.message, wrap: true },
          { type: "FactSet", facts: [
            { title: "Rule", value: alert.ruleName },
            { title: "Metric", value: alert.metric },
            { title: "Value", value: String(alert.value) },
            { title: "Threshold", value: String(alert.threshold) },
            { title: "Tenant", value: alert.tenantId.slice(0, 8) + "..." },
          ]},
        ],
      },
    }],
  };

  const resp = await fetch(alert.notifyTarget, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Webhook returned ${resp.status}: ${await resp.text()}`);
  }
  console.log(`[notify] Webhook sent for rule "${alert.ruleName}"`);
}

async function sendEmail(alert: TriggeredAlert): Promise<void> {
  // Uses SMTP env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.error("[notify] Email skipped — SMTP_HOST not configured");
    return;
  }

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "security-dashboard@noreply.com",
    to: alert.notifyTarget,
    subject: `🚨 Security Alert: ${alert.ruleName}`,
    html: `
      <h2>🛡️ Security Dashboard Alert</h2>
      <p><strong>${alert.message}</strong></p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <tr><td><strong>Rule</strong></td><td>${alert.ruleName}</td></tr>
        <tr><td><strong>Metric</strong></td><td>${alert.metric}</td></tr>
        <tr><td><strong>Current Value</strong></td><td>${alert.value}</td></tr>
        <tr><td><strong>Threshold</strong></td><td>${alert.threshold}</td></tr>
        <tr><td><strong>Tenant</strong></td><td>${alert.tenantId}</td></tr>
      </table>
    `,
  });
  console.log(`[notify] Email sent to ${alert.notifyTarget} for rule "${alert.ruleName}"`);
}
