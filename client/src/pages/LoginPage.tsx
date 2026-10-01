import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, ApiError, errorMessage } from "@/api";
import { Button, TextInput } from "@/components/Field";
import { staticAssistantDescription, staticAssistantName } from "@/lib/assistant";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/";
  return raw;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The name stamped into index.html is right immediately; /api/health (no auth) confirms it from the server.
  const [name, setName] = useState(staticAssistantName);
  const tagline = staticAssistantDescription() ?? "Executive assistant tracker";

  useEffect(() => {
    document.title = `Sign in · ${name}`;
  }, [name]);

  useEffect(() => {
    api
      .health()
      .then((health) => {
        if (health?.assistantName) setName(health.assistantName);
      })
      .catch(() => {
        /* keep the stamped name */
      });
    api.auth
      .me()
      .then((me) => {
        if (me?.authenticated) navigate(next, { replace: true });
      })
      .catch(() => {
        /* not signed in, or API not ready — show the form */
      });
  }, [navigate, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(password);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError("That passphrase isn't right. Try again.");
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-8">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
            <svg viewBox="0 0 128 128" className="h-8 w-8" aria-hidden="true">
              <path d="M30 34 L64 100 L98 34" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-slate-900">{name}</h1>
          <p className="text-sm text-slate-500">{tagline}</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Passphrase</span>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="••••••••••••"
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="mt-4 text-center text-xs text-slate-400">This device stays signed in for 90 days.</p>
      </form>
    </main>
  );
}
