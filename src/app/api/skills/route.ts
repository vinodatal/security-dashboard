import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { saveCustomSkill, getCustomSkills, deleteCustomSkill } from "@/lib/db";
import { BUILT_IN_SKILLS, type SkillPackage } from "@/lib/skills";

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { action } = body;
  const { tenantId } = session;

  try {
    switch (action) {
      case "list": {
        const custom = getCustomSkills(tenantId);
        const builtIn = BUILT_IN_SKILLS.map((s) => ({ ...s, source: "built-in" }));
        return NextResponse.json({
          skills: [...builtIn, ...custom.map((c) => ({ ...(c.definition as Record<string, unknown>), ...c, source: c.source }))],
          builtInCount: builtIn.length,
          customCount: custom.length,
          totalCount: builtIn.length + custom.length,
        });
      }

      case "get": {
        if (!body.skillId) {
          return NextResponse.json({ error: "skillId required" }, { status: 400 });
        }
        const builtIn = BUILT_IN_SKILLS.find((s) => s.id === body.skillId);
        if (builtIn) return NextResponse.json({ skill: { ...builtIn, source: "built-in" } });

        const customs = getCustomSkills(tenantId);
        const custom = customs.find((c) => c.skillId === body.skillId);
        if (custom) return NextResponse.json({ skill: { ...(custom.definition as Record<string, unknown>), ...custom } });

        return NextResponse.json({ error: `Skill '${body.skillId}' not found` }, { status: 404 });
      }

      case "save": {
        if (!body.skill) {
          return NextResponse.json({ error: "skill object required" }, { status: 400 });
        }
        const skill = body.skill as SkillPackage;
        const id = saveCustomSkill(tenantId, {
          id: skill.id || `custom-skill-${Date.now()}`,
          name: skill.name,
          description: skill.description,
          category: skill.category || "general",
          tags: skill.tags || [],
          definition: skill as unknown as Record<string, unknown>,
          source: skill.source || "uploaded",
        });
        return NextResponse.json({ saved: true, dbId: id, skillId: skill.id });
      }

      case "delete": {
        if (!body.skillId) {
          return NextResponse.json({ error: "skillId required" }, { status: 400 });
        }
        // Prevent deleting built-in skills
        if (BUILT_IN_SKILLS.some((s) => s.id === body.skillId)) {
          return NextResponse.json({ error: "Cannot delete built-in skills" }, { status: 400 });
        }
        deleteCustomSkill(body.skillId, tenantId);
        return NextResponse.json({ deleted: true });
      }

      case "create-from-nl": {
        if (!body.description) {
          return NextResponse.json({ error: "description required" }, { status: 400 });
        }
        const { chatCompletion } = await import("@/lib/agent/llm");

        const systemPrompt = `You are a security skill architect. Create a structured skill package from a natural language description.

A skill package can contain:
- KQL queries for threat hunting (target: "defender" for Advanced Hunting, "sentinel" for Log Analytics)
- Investigation instructions (markdown guidance for analysts)
- Remediation scripts (Azure CLI / PowerShell commands)
- Detection rules (KQL queries with severity and MITRE mappings)

Output ONLY valid JSON with this structure:
{
  "id": "kebab-case-id",
  "name": "Skill Name",
  "description": "What this skill does",
  "category": "threat-hunting|incident-response|compliance|identity-security|data-protection|infrastructure|detection|remediation|general",
  "tags": ["tag1", "tag2"],
  "requiredTools": ["run_hunting_query"],
  "requiredLicenses": [],
  "applicableWorkflows": [],
  "queries": [
    {
      "id": "query-id",
      "name": "Query Name",
      "description": "What it detects",
      "query": "KQL query here",
      "target": "defender",
      "mitreTactics": ["Tactic"],
      "mitreTechniques": ["T1234"]
    }
  ],
  "instructions": "Step-by-step investigation guidance in markdown",
  "remediation": [
    {
      "finding": "What was found",
      "severity": "critical|high|medium|low",
      "description": "How to fix it",
      "scripts": [{ "type": "azure-cli", "label": "Fix description", "command": "az ..." }],
      "verification": "command to verify fix",
      "docUrl": "https://learn.microsoft.com/..."
    }
  ]
}

Include REAL KQL queries that work against Microsoft Defender / Sentinel schemas.
Include REAL Azure CLI / PowerShell remediation commands.
Include REAL Microsoft Learn documentation URLs.
Do NOT include markdown code fences around the JSON. Output ONLY the JSON object.`;

        const result = await chatCompletion(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: body.description },
          ],
          undefined,
          3000
        );

        try {
          const content = result.message.content || "";
          const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
          const skill = JSON.parse(jsonStr);
          skill.source = "nl-generated";
          return NextResponse.json({ skill });
        } catch {
          return NextResponse.json(
            { error: "Failed to parse generated skill", raw: result.message.content },
            { status: 500 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use: list, get, save, delete, create-from-nl` },
          { status: 400 }
        );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
