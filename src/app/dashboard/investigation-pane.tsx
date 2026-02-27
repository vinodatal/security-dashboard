"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./mermaid-diagram";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ tool: string }>;
  suggestions?: string[];
}

const FOLLOW_UPS: Record<string, string[]> = {
  no_mfa: [
    "What apps does this user access?",
    "Show their sign-in locations for the past 30 days",
    "What conditional access policies apply to them?",
    "How do I enable MFA for this user?",
  ],
  stale_account: [
    "Is this a service account or human?",
    "What apps or groups depend on this account?",
    "Should I disable this account?",
    "Show audit logs for this user's last activities",
  ],
  excessive_roles: [
    "Which roles can be safely removed?",
    "Show what actions this user performed with admin privileges",
    "Are there other users who can cover these roles?",
    "What's the least privilege recommendation?",
  ],
  custom: [
    "Map attack paths for privileged admins",
    "Show all privileged users without MFA",
    "What are the top security risks in this tenant?",
    "Summarize the security posture for an executive report",
  ],
};

export function InvestigationPane({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastFindingType, setLastFindingType] = useState("custom");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, loading]);

  const sendInvestigation = async (finding: { type: string; user?: string; detail: string; severity: string }) => {
    const userMsg: ChatMessage = {
      role: "user",
      content: finding.user
        ? `**${finding.type}** — ${finding.user}\n${finding.detail}`
        : finding.detail,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLastFindingType(finding.type);
    setLoading(true);

    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finding }),
      });
      const data = await res.json();

      const suggestions = FOLLOW_UPS[finding.type] ?? FOLLOW_UPS.custom;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.error ?? data.narrative ?? "No response",
        toolCalls: data.toolCalls,
        suggestions,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    sendInvestigation({ type: "custom", detail: text, severity: "medium" });
  };

  const handleSuggestion = (text: string) => {
    if (loading) return;
    sendInvestigation({ type: lastFindingType, detail: text, severity: "medium" });
  };

  // Expose investigate for parent to call
  (InvestigationPane as any)._investigate = sendInvestigation;

  return (
    <div className="fixed inset-y-0 left-0 w-[480px] bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">🔍 Investigation</h2>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center mt-8 space-y-4">
            <p className="text-gray-600 text-sm">Click 🔍 on any finding, or ask a question.</p>
            <div className="space-y-2">
              {FOLLOW_UPS.custom.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestion(q)}
                  className="block w-full text-left px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-400 hover:text-white hover:border-gray-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === "user" ? "ml-8" : ""}>
            <div className={`rounded-lg px-4 py-3 ${msg.role === "user" ? "bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800" : "bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800"}`}>
              {msg.role === "assistant" && msg.toolCalls?.length ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.toolCalls.map((tc, j) => (
                    <span key={j} className="text-xs bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">{tc.tool}</span>
                  ))}
                </div>
              ) : null}
              <div className="prose prose-invert prose-sm max-w-none
                [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                [&_li]:my-0.5 [&_p]:my-1.5
                [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm
                [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold
                [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white
                [&_strong]:text-white
                [&_code]:text-blue-300 [&_code]:bg-gray-800 [&_code]:px-1 [&_code]:rounded
                [&_pre]:bg-gray-800 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto
                [&_a]:text-blue-400
                [&_table]:w-full [&_th]:text-left [&_th]:p-2 [&_td]:p-2
                [&_th]:bg-gray-800 [&_th]:text-gray-300 [&_td]:border-b [&_td]:border-gray-800
                [&_blockquote]:border-l-2 [&_blockquote]:border-gray-700 [&_blockquote]:pl-3 [&_blockquote]:text-gray-400">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const lang = className?.replace("language-", "") ?? "";
                      if (lang === "mermaid") {
                        return <MermaidDiagram code={String(children).trim()} />;
                      }
                      if (!className) {
                        return <code {...props}>{children}</code>;
                      }
                      return (
                        <pre className="bg-gray-800 p-3 rounded-lg overflow-x-auto">
                          <code className={className} {...props}>{children}</code>
                        </pre>
                      );
                    },
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>

              {/* Follow-up suggestions */}
              {msg.role === "assistant" && msg.suggestions && i === messages.length - 1 && !loading && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
                  <p className="text-xs text-gray-600">Follow up:</p>
                  {msg.suggestions.map((s, j) => (
                    <button
                      key={j}
                      onClick={() => handleSuggestion(s)}
                      className="block w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                    >
                      → {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            Investigating...
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a follow-up or new question..."
            disabled={loading}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-lg text-sm"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

