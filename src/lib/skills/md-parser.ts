/**
 * Markdown Skill Parser — extracts structured skill data from .md files.
 *
 * Parses markdown for:
 * - KQL code blocks → queries[]
 * - bash/azure-cli code blocks → remediation scripts
 * - powershell code blocks → remediation scripts
 * - MITRE references (T1234) → tags
 * - Headings → skill name/description
 * - Body text → instructions
 */

import type { SkillPackage, SkillQuery, SkillRemediation } from "../skills";

const KQL_KEYWORDS = [
  "where", "summarize", "project", "extend", "join", "union",
  "let", "datatable", "ago(", "count()", "dcount(", "make_set(",
  "DeviceProcessEvents", "DeviceNetworkEvents", "DeviceFileEvents",
  "IdentityLogonEvents", "IdentityQueryEvents", "CloudAppEvents",
  "SecurityAlert", "SecurityIncident", "SigninLogs", "AuditLogs",
];

function isKQL(code: string): boolean {
  const lower = code.toLowerCase();
  return KQL_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function detectTarget(code: string): "defender" | "sentinel" {
  const defenderTables = ["DeviceProcessEvents", "DeviceNetworkEvents", "DeviceFileEvents",
    "DeviceLogonEvents", "IdentityLogonEvents", "IdentityQueryEvents",
    "CloudAppEvents", "EmailEvents", "AlertEvidence"];
  if (defenderTables.some((t) => code.includes(t))) return "defender";
  return "sentinel";
}

function extractMitreTechniques(text: string): string[] {
  const matches = text.match(/T\d{4}(?:\.\d{3})?/g);
  return matches ? [...new Set(matches)] : [];
}

function extractMitreTactics(text: string): string[] {
  const tactics = [
    "Initial Access", "Execution", "Persistence", "Privilege Escalation",
    "Defense Evasion", "Credential Access", "Discovery", "Lateral Movement",
    "Collection", "Exfiltration", "Command and Control", "Impact",
  ];
  return tactics.filter((t) => text.toLowerCase().includes(t.toLowerCase()));
}

function guessCategory(text: string): SkillPackage["category"] {
  const lower = text.toLowerCase();
  if (lower.includes("hunt") || lower.includes("detect") || lower.includes("kql")) return "threat-hunting";
  if (lower.includes("incident") || lower.includes("respond")) return "incident-response";
  if (lower.includes("comply") || lower.includes("compliance") || lower.includes("hipaa") || lower.includes("soc2")) return "compliance";
  if (lower.includes("identity") || lower.includes("entra") || lower.includes("mfa") || lower.includes("admin")) return "identity-security";
  if (lower.includes("dlp") || lower.includes("purview") || lower.includes("data loss") || lower.includes("sensitivity")) return "data-protection";
  if (lower.includes("infra") || lower.includes("network") || lower.includes("nsg") || lower.includes("firewall")) return "infrastructure";
  if (lower.includes("remediat") || lower.includes("fix") || lower.includes("harden")) return "remediation";
  return "general";
}

interface CodeBlock {
  language: string;
  code: string;
  precedingHeading?: string;
  precedingText?: string;
}

function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    const lang = match[1] || "";
    const code = match[2].trim();
    // Find the nearest heading before this code block
    const before = markdown.substring(0, match.index);
    const headings = before.match(/^#{1,4}\s+(.+)$/gm);
    const lastHeading = headings ? headings[headings.length - 1].replace(/^#+\s+/, "") : undefined;
    // Find text between last heading and code block
    const lastHeadingIdx = headings ? before.lastIndexOf(headings[headings.length - 1]) : -1;
    const textAfterHeading = lastHeadingIdx >= 0
      ? before.substring(lastHeadingIdx + (headings![headings!.length - 1]).length).trim()
      : undefined;

    blocks.push({
      language: lang.toLowerCase(),
      code,
      precedingHeading: lastHeading,
      precedingText: textAfterHeading?.substring(0, 200),
    });
  }

  return blocks;
}

export function parseMarkdownSkill(
  markdown: string,
  filename?: string
): SkillPackage {
  const blocks = extractCodeBlocks(markdown);

  // Extract skill name from first H1/H2, or filename
  const titleMatch = markdown.match(/^#\s+(.+)$/m) || markdown.match(/^##\s+(.+)$/m);
  const name = titleMatch ? titleMatch[1].trim() : (filename?.replace(/\.md$/, "").replace(/[-_]/g, " ") ?? "Uploaded Skill");

  // Extract description from first paragraph after title
  const descMatch = markdown.match(/^#.*\n+([^#\n][\s\S]*?)(?=\n#|\n```|\n$)/m);
  const description = descMatch ? descMatch[1].trim().substring(0, 300) : `Skill imported from ${filename ?? "markdown file"}`;

  // Parse code blocks into queries and remediation
  const queries: SkillQuery[] = [];
  const remediation: SkillRemediation[] = [];

  for (const block of blocks) {
    if (block.language === "kql" || (block.language === "" && isKQL(block.code))) {
      queries.push({
        id: `q-${queries.length + 1}`,
        name: block.precedingHeading ?? `Query ${queries.length + 1}`,
        description: block.precedingText ?? "",
        query: block.code,
        target: detectTarget(block.code),
        mitreTactics: extractMitreTactics((block.precedingHeading ?? "") + (block.precedingText ?? "")),
        mitreTechniques: extractMitreTechniques(block.code + (block.precedingText ?? "")),
      });
    } else if (block.language === "bash" || block.language === "sh" || block.language === "azure-cli") {
      remediation.push({
        finding: block.precedingHeading ?? `Fix ${remediation.length + 1}`,
        severity: "medium",
        description: block.precedingText ?? "",
        scripts: [{ type: "azure-cli", label: block.precedingHeading ?? "Fix", command: block.code }],
      });
    } else if (block.language === "powershell" || block.language === "ps1") {
      // Check if there's already a remediation entry from a preceding bash block with same heading
      const existing = remediation.find((r) => r.finding === block.precedingHeading);
      if (existing) {
        existing.scripts.push({ type: "powershell", label: block.precedingHeading ?? "Fix", command: block.code });
      } else {
        remediation.push({
          finding: block.precedingHeading ?? `Fix ${remediation.length + 1}`,
          severity: "medium",
          description: block.precedingText ?? "",
          scripts: [{ type: "powershell", label: block.precedingHeading ?? "Fix", command: block.code }],
        });
      }
    }
  }

  // Extract instructions — everything that's NOT code blocks
  const instructionsText = markdown
    .replace(/```[\s\S]*?```/g, "") // remove code blocks
    .replace(/^#\s+.+$/m, "")       // remove title
    .trim();

  // Extract tags from MITRE references + keywords
  const allText = markdown;
  const mitreTechniques = extractMitreTechniques(allText);
  const mitreTactics = extractMitreTactics(allText);
  const tags = [
    ...mitreTechniques.slice(0, 5),
    ...mitreTactics.slice(0, 3),
  ];

  // Guess required tools
  const requiredTools: string[] = [];
  if (queries.some((q) => q.target === "defender")) requiredTools.push("run_hunting_query");
  if (queries.some((q) => q.target === "sentinel")) requiredTools.push("query_sentinel");
  if (allText.toLowerCase().includes("sign-in") || allText.toLowerCase().includes("signin")) requiredTools.push("get_entra_signin_logs");
  if (allText.toLowerCase().includes("risky user")) requiredTools.push("get_entra_risky_users");

  const id = (filename ?? name)
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id,
    name,
    description,
    category: guessCategory(allText),
    tags,
    requiredTools: [...new Set(requiredTools)],
    queries: queries.length > 0 ? queries : undefined,
    instructions: instructionsText.length > 50 ? instructionsText : undefined,
    remediation: remediation.length > 0 ? remediation : undefined,
    source: "uploaded",
  };
}
