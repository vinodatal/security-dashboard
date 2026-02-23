// Jira and ServiceNow ticket creation from alert triggers

export interface TicketConfig {
  type: "jira" | "servicenow";
  baseUrl: string;
  auth: string; // base64 encoded user:token for Jira, or Bearer token for ServiceNow
  projectKey?: string; // Jira project key
  issueType?: string;  // Jira issue type (default: "Bug")
  tableName?: string;  // ServiceNow table (default: "incident")
}

export interface TicketPayload {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  tenantId: string;
  metric: string;
  value: number;
  threshold: number;
}

export async function createTicket(config: TicketConfig, payload: TicketPayload): Promise<{ id: string; url: string }> {
  switch (config.type) {
    case "jira":
      return createJiraTicket(config, payload);
    case "servicenow":
      return createServiceNowIncident(config, payload);
    default:
      throw new Error(`Unknown integration type: ${config.type}`);
  }
}

async function createJiraTicket(config: TicketConfig, payload: TicketPayload): Promise<{ id: string; url: string }> {
  const priorityMap: Record<string, string> = { critical: "1", high: "2", medium: "3", low: "4" };

  const body = {
    fields: {
      project: { key: config.projectKey ?? "SEC" },
      issuetype: { name: config.issueType ?? "Bug" },
      summary: `🛡️ ${payload.title}`,
      description: {
        type: "doc",
        version: 1,
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: payload.description }],
        }, {
          type: "table",
          attrs: { isNumberColumnEnabled: false, layout: "default" },
          content: [
            tableRow("Metric", payload.metric),
            tableRow("Current Value", String(payload.value)),
            tableRow("Threshold", String(payload.threshold)),
            tableRow("Tenant", payload.tenantId),
            tableRow("Severity", payload.severity),
          ],
        }],
      },
      priority: { id: priorityMap[payload.severity] ?? "3" },
      labels: ["security-dashboard", "auto-created"],
    },
  };

  const resp = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${config.auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Jira API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const result = await resp.json();
  return {
    id: result.key,
    url: `${config.baseUrl}/browse/${result.key}`,
  };
}

function tableRow(label: string, value: string) {
  return {
    type: "tableRow",
    content: [
      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: label, marks: [{ type: "strong" }] }] }] },
      { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] },
    ],
  };
}

async function createServiceNowIncident(config: TicketConfig, payload: TicketPayload): Promise<{ id: string; url: string }> {
  const urgencyMap: Record<string, string> = { critical: "1", high: "1", medium: "2", low: "3" };
  const impactMap: Record<string, string> = { critical: "1", high: "2", medium: "2", low: "3" };

  const body = {
    short_description: `🛡️ ${payload.title}`,
    description: `${payload.description}\n\nMetric: ${payload.metric}\nValue: ${payload.value}\nThreshold: ${payload.threshold}\nTenant: ${payload.tenantId}`,
    urgency: urgencyMap[payload.severity] ?? "2",
    impact: impactMap[payload.severity] ?? "2",
    category: "Security",
  };

  const table = config.tableName ?? "incident";
  const resp = await fetch(`${config.baseUrl}/api/now/table/${table}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`ServiceNow API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const result = await resp.json();
  const sysId = result.result?.sys_id;
  return {
    id: result.result?.number ?? sysId,
    url: `${config.baseUrl}/nav_to.do?uri=incident.do?sys_id=${sysId}`,
  };
}
