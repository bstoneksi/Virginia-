import { useNavigate } from "react-router";
import { api, errorMessage } from "@/api";
import { Button } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { useBootstrap } from "@/lib/bootstrap";
import { useToast } from "@/lib/toast";

export function AboutSettings() {
  const { aiConfigured, anthropicModel, version, me } = useBootstrap();
  const toast = useToast();
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
    navigate("/login", { replace: true });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${aiConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <Icon name={aiConfigured ? "sparkle" : "alert"} className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-medium">{aiConfigured ? "Claude extraction is on" : "Claude extraction is off"}</p>
          <p className="mt-0.5 text-xs opacity-80">
            {aiConfigured
              ? `Captures are read by Claude (${anthropicModel}); transcripts and photos become proposals for review.`
              : `Set ANTHROPIC_API_KEY on the server to extract from transcripts and photos with ${anthropicModel}. Until then only explicitly tagged lines are parsed.`}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h3 className="text-sm font-semibold text-slate-900">Account</h3>
        <p className="mt-1">
          Signed in{me ? ` as ${me.fullName} (${me.initials})` : ""}. Sessions last 90 days per device.
        </p>
        <Button variant="secondary" onClick={() => void logout()} className="mt-3">
          <Icon name="logout" className="h-4 w-4" /> Log out
        </Button>
      </div>

      <p className="text-xs text-slate-400">Virginia v{version} · Single-user · Nothing the AI proposes lands without your review.</p>
    </section>
  );
}
