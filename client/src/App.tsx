// Placeholder shell — replaced by the client-ui build (routes, layout, pages). See docs/SPEC.md §8.
import { CATEGORY_LABELS } from "@shared/types";

export function App() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Virginia</h1>
      <p className="text-sm opacity-70">Client scaffold. Categories: {Object.values(CATEGORY_LABELS).join(" · ")}</p>
    </main>
  );
}
