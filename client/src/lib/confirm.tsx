import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Sheet } from "@/components/Sheet";
import { Button } from "@/components/Field";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => setPending({ opts, resolve }));
  }, []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet
        open={pending !== null}
        onClose={() => finish(false)}
        variant="center"
        title={pending?.opts.title}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => finish(false)}>
              {pending?.opts.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={pending?.opts.danger ? "danger" : "primary"} onClick={() => finish(true)} autoFocus>
              {pending?.opts.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        }
      >
        {pending?.opts.message && <p className="text-sm text-slate-700">{pending.opts.message}</p>}
      </Sheet>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
