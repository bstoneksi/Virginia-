import { Link } from "react-router";
import { EmptyState } from "@/components/States";
import { usePageTitle } from "@/lib/shell";

export function NotFoundPage() {
  usePageTitle("Not found");
  return (
    <EmptyState
      title="That page doesn't exist"
      action={
        <Link to="/" className="text-sm font-medium text-brand underline">
          Go to Today
        </Link>
      }
    />
  );
}
