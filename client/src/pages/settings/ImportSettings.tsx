import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import type { ImportCommitResult, ImportPreview, ImportRow } from "@shared/types";
import { api, errorMessage } from "@/api";
import { Chip } from "@/components/Badges";
import { Button } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { emitItemChange } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { ImportRowEditor } from "./ImportRowEditor";

const ACCEPT = ".xlsx,.xlsm,.csv";

export function ImportSettings() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
      toast.error("Drop an .xlsx, .xlsm or .csv file");
      return;
    }
    setBusy("preview");
    setResult(null);
    try {
      const p = await api.importer.preview(file);
      setPreview(p);
      setRows(p.rows.map((r) => ({ ...r, include: r.include ?? true })));
      if (p.rows.length === 0) toast.error("No rows recognised — check the sheet has Date | Note | Division | Owner/Target | Priority | Due Date | Status headers");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void load(e.dataTransfer.files[0]);
  };

  const commit = async () => {
    const included = rows.filter((r) => r.include);
    if (included.length === 0) return;
    setBusy("commit");
    try {
      const res = await api.importer.commit(included, preview?.filename);
      for (const item of res.items ?? []) emitItemChange({ type: "created", item });
      setResult(res);
      setPreview(null);
      setRows([]);
      toast.success(`Imported ${res.created} item${res.created === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const updateRow = (index: number, next: ImportRow) => setRows((prev) => prev.map((r, i) => (i === index ? next : r)));
  const includedCount = rows.filter((r) => r.include).length;
  const warningCount = rows.filter((r) => r.include && r.warnings.length > 0).length;
  const setAll = (include: boolean) => setRows((prev) => prev.map((r) => ({ ...r, include })));

  return (
    <section className="flex flex-col gap-4">
      {!preview && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center ${dragging ? "border-brand bg-brand/5" : "border-slate-300 bg-white"}`}
        >
          <Icon name="upload" className="h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-800">Drop the Brain Dump workbook here</p>
          <p className="max-w-sm text-xs text-slate-500">
            .xlsx, .xlsm or .csv with <em>Date | Note | Division | Owner/Target | Priority | Due Date | Status</em> headers. New Business → NB, Action Items → A, Parking Lot → Parked, Watch List → W.
          </p>
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => void load(e.target.files?.[0])} />
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
            {busy === "preview" ? "Reading…" : "Choose file"}
          </Button>
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Icon name="check" className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            Imported <strong>{result.created}</strong> item{result.created === 1 ? "" : "s"}.{" "}
            <Link to="/board" className="font-medium underline">
              Open the board
            </Link>
          </span>
        </div>
      )}

      {preview && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-900">{preview.filename}</span>
            <Chip>{preview.sheetNames.length} sheet{preview.sheetNames.length === 1 ? "" : "s"}</Chip>
            {preview.detectedTables.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
            <span className="ml-auto text-xs text-slate-500">
              {includedCount} of {rows.length} rows selected{warningCount > 0 && ` · ${warningCount} with warnings`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
              Select none
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, include: r.warnings.length === 0 })))}>
              Only clean rows
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" onClick={() => setPreview(null)} disabled={busy !== null}>
              Choose another file
            </Button>
            <Button size="sm" variant="primary" onClick={() => void commit()} disabled={busy !== null || includedCount === 0}>
              {busy === "commit" ? "Importing…" : `Import ${includedCount} row${includedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rows.map((row, index) => (
              <ImportRowEditor key={`${row.sheet}-${row.rowNumber}-${index}`} row={row} onChange={(next) => updateRow(index, next)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
