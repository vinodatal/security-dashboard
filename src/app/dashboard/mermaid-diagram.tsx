"use client";

import { useEffect, useRef, useState } from "react";

export function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          themeVariables: {
            primaryColor: "#1e40af",
            primaryTextColor: "#e5e7eb",
            primaryBorderColor: "#3b82f6",
            lineColor: "#6b7280",
            secondaryColor: "#374151",
            tertiaryColor: "#1f2937",
          },
        });
        const id = `mermaid-${Date.now()}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to render diagram");
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg text-xs text-gray-600 dark:text-gray-400 overflow-x-auto">
        {code}
      </pre>
    );
  }

  if (!svg) {
    return <div className="text-gray-500 text-sm">Rendering diagram...</div>;
  }

  return (
    <div
      ref={containerRef}
      className="overflow-x-auto bg-gray-100 dark:bg-gray-800 rounded-lg p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
