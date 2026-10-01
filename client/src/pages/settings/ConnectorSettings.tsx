import { useState } from "react";
import { Button } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { useAssistant, useBootstrap } from "@/lib/bootstrap";
import { useToast } from "@/lib/toast";

const TOOLS = ["list_items", "get_item", "add_items", "update_item", "get_agenda", "get_today", "search", "list_reference", "add_brief", "run_daily_brief"];

/** `https://host/mcp/abc123…` → `https://host/mcp/••••••••••••` so the token is not on screen by default. */
function maskUrl(url: string): string {
  const cut = url.lastIndexOf("/");
  return cut === -1 ? url : `${url.slice(0, cut + 1)}••••••••••••`;
}

export function ConnectorSettings() {
  const { mcpConfigured, mcpUrl } = useBootstrap();
  const { name } = useAssistant();
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const prefix = `${window.location.origin}/mcp/`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl ?? prefix);
      toast.success(mcpUrl ? "Connector URL copied — paste it into Claude" : "Copied — append your MCP_TOKEN");
    } catch {
      toast.error("Clipboard blocked — reveal the URL, select it and copy");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${mcpConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <Icon name={mcpConfigured ? "check" : "alert"} className="h-5 w-5 shrink-0" />
        {mcpConfigured ? "MCP connector is enabled on this server." : "MCP_TOKEN is not set — the /mcp endpoint is disabled until you add it to the server environment."}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Connector URL</h3>
        <p className="mt-1 text-sm text-slate-600">
          The {name} project in Claude talks to this tracker through a custom connector. The URL is this server plus the secret token set as{" "}
          <code className="rounded bg-slate-100 px-1">MCP_TOKEN</code>:
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
            {mcpUrl ? (
              revealed ? mcpUrl : maskUrl(mcpUrl)
            ) : (
              <>
                {prefix}
                <span className="text-slate-400">&lt;MCP_TOKEN&gt;</span>
              </>
            )}
          </code>
          <div className="flex shrink-0 gap-2">
            {mcpUrl && (
              <Button variant="secondary" onClick={() => setRevealed((v) => !v)} aria-pressed={revealed}>
                {revealed ? "Hide" : "Reveal"}
              </Button>
            )}
            <Button variant="secondary" onClick={() => void copy()}>
              <Icon name="copy" className="h-4 w-4" /> {mcpUrl ? "Copy URL" : "Copy base URL"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {mcpUrl
            ? "This URL contains your secret token — paste it only into Claude's connector settings. Rotate MCP_TOKEN on the server if it ever leaks."
            : "Once MCP_TOKEN is set on the server, the complete URL appears here."}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Set it up in Claude</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Open Claude → Settings → Connectors → <strong>Add custom connector</strong>.</li>
          <li>Name it <strong>{name}</strong> and paste the URL above. No OAuth or extra header is needed — the token in the URL is the credential.</li>
          <li>Enable it in the “{name} – Executive Assistant” project.</li>
          <li>
            Tools available:{" "}
            {TOOLS.map((tool, i) => (
              <span key={tool}>
                {i > 0 && ", "}
                <code>{tool}</code>
              </span>
            ))}
            .
          </li>
        </ol>
      </div>
    </section>
  );
}
