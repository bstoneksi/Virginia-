import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const inputClass =
  "w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-500";

/**
 * SPEC §0.5: every control is at least 44 px tall on a phone. Compact ("sm") controls shrink to their
 * dense desktop size only from `md` up, where a pointer is the norm.
 */
export const compactTapClass = "min-h-11 md:min-h-9";

export function Field({ label, children, hint, className = "" }: { label: ReactNode; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${className}`} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[length:16px] bg-[position:right_0.6rem_center] bg-no-repeat pr-8 ${className}`}>
      {children}
    </select>
  );
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} py-2 leading-snug ${className}`} />;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-light disabled:bg-slate-300",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400",
  subtle: "bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? `${compactTapClass} px-3 text-xs md:px-2.5` : "min-h-11 px-4 text-sm";
  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${sizing} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  // The visible label names the switch for assistive tech (the label may be any node, so link it by id).
  const labelId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-800 disabled:opacity-50"
    >
      <span className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-brand" : "bg-slate-300"}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`} />
      </span>
      <span id={labelId}>{label}</span>
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  activeStyle?: { background: string; color: string };
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
  size = "md",
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  // 44 px minimum in both directions on a phone (a one-letter option is otherwise ~26 px wide).
  const sizing = size === "sm" ? "min-h-11 min-w-11 px-2 text-xs md:min-h-8 md:min-w-0" : "min-h-11 min-w-11 px-3 text-sm md:min-h-9 md:min-w-0";
  return (
    <div className={`inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-slate-100 p-1 ${className}`} role="radiogroup">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            style={active ? opt.activeStyle : undefined}
            className={`rounded-md font-semibold transition-colors ${sizing} ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/60"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
