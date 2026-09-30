/**
 * Excel / CSV import (docs/SPEC.md §4 "Import"). Parsing is `deps.parseImportFile` (server/import);
 * without it, preview answers 501. Commit creates one `import` capture as provenance, then the items.
 */
import { Hono } from "hono";
import type { ImportCommitResult, Item } from "../../shared/types";
import { nowISO, todayISO } from "../db/index";
import { HttpError, NotImplementedError, PayloadTooLargeError, ValidationError } from "../lib/errors";
import { importCommitSchema, parseJsonBody } from "../lib/validate";
import { extractContext } from "./captures";
import type { RouteDeps } from "./deps";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))];
}

export function importerRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.post("/import/preview", async (c) => {
    if (!deps.parseImportFile) throw new NotImplementedError("Importer not wired");
    const contentType = (c.req.header("content-type") ?? "").toLowerCase();
    if (!contentType.includes("multipart/form-data")) throw new HttpError(415, "Send multipart/form-data with a `file` field");
    const body = await c.req.parseBody();
    const upload = body.file ?? body["file[]"] ?? body.files;
    if (!(upload instanceof File) || upload.size === 0) throw new ValidationError("Upload a .xlsx, .xlsm or .csv file in the `file` field");
    if (upload.size > MAX_IMPORT_BYTES) throw new PayloadTooLargeError("Import files are limited to 25 MB");
    const preview = await deps.parseImportFile(
      { filename: upload.name || "import", bytes: new Uint8Array(await upload.arrayBuffer()) },
      extractContext(repo),
    );
    return c.json(preview);
  });

  router.post("/import/commit", async (c) => {
    const body = await parseJsonBody(c, importCommitSchema);
    const rows = body.rows.filter((row) => row.include);
    if (rows.length === 0) throw new ValidationError("No rows selected for import");

    const result = repo.transaction((): ImportCommitResult => {
      const sheets = unique(rows.map((r) => r.sheet));
      const tables = unique(rows.map((r) => r.table));
      const capture = repo.createCapture({
        kind: "import",
        title: body.filename ? `Import: ${body.filename}` : `Import ${todayISO()}`,
        notes: [
          `Imported ${rows.length} row(s)${sheets.length > 0 ? ` from ${sheets.join(", ")}` : ""}`,
          ...(tables.length > 0 ? [`Tables: ${tables.join(", ")}`] : []),
        ],
      });
      const items: Item[] = [];
      for (const row of rows) {
        try {
          const item = repo.createItem(row.draft, { sourceCaptureId: capture.id });
          repo.recordAcceptedProposal(
            capture.id,
            {
              draft: row.draft,
              confidence: 1,
              inferred: false,
              sourceExcerpt: `${row.sheet || "sheet"} › ${row.table || "table"} row ${row.rowNumber}`,
              warnings: row.warnings,
            },
            item.id,
          );
          items.push(item);
        } catch (err) {
          if (err instanceof HttpError) {
            throw new HttpError(err.status, `Row ${row.rowNumber} (${row.table || "import"}): ${err.message}`, {
              rowNumber: row.rowNumber,
              table: row.table,
              sheet: row.sheet,
              cause: err.details,
            });
          }
          throw err;
        }
      }
      repo.updateCapture(capture.id, { status: "reviewed", reviewedAt: nowISO() });
      return { created: items.length, captureId: capture.id, items };
    });
    return c.json(result, 201);
  });

  return router;
}
