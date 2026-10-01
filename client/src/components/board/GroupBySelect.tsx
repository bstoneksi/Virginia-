import { useId } from "react";
import type { GroupMode } from "@shared/boardGroups";
import { Segmented, type SegmentedOption } from "../Field";

interface GroupBySelectProps {
  value: GroupMode;
  onChange: (mode: GroupMode) => void;
  /** The brand page already fixes the division, so grouping by brand is redundant there. */
  hideBrand?: boolean;
  className?: string;
}

/** "Group by" control for the Board: None (four status columns) · Brand · Person swimlanes. */
export function GroupBySelect({ value, onChange, hideBrand = false, className = "" }: GroupBySelectProps) {
  const labelId = useId();
  const options: SegmentedOption<GroupMode>[] = [
    { value: "none", label: "None", title: "Four status columns" },
    ...(hideBrand ? [] : [{ value: "brand" as const, label: "Brand", title: "A lane per brand or division" }]),
    { value: "person", label: "Person", title: "A lane per owner" },
  ];
  return (
    <div role="group" aria-labelledby={labelId} className={`flex items-center gap-2 ${className}`}>
      <span id={labelId} className="text-xs font-medium text-slate-500">
        Group by
      </span>
      <Segmented<GroupMode> value={value} onChange={onChange} size="sm" options={options} />
    </div>
  );
}
