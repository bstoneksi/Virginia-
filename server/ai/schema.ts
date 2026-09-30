/**
 * Zod schema for Claude's structured output (docs/SPEC.md §5). Passed to the API through
 * `zodOutputFormat(ExtractionSchema)`; the SDK validates the model's JSON against it on parse.
 *
 * Note: the SDK's schema transform keeps only types/required/additionalProperties for the API
 * grammar and moves `enum` / `min` / `max` into descriptions, so the system prompt spells the
 * allowed values out and `prompt.ts` clamps / re-validates every field after parsing.
 */
import { z } from "zod";
import { CATEGORIES, PRIORITIES, STATUSES } from "../../shared/types";

export const ExtractedProposalSchema = z.object({
  category: z.enum(CATEGORIES).describe('One of "A" action, "Q" question, "I" idea, "D" decision, "W" watch, "NB" new business'),
  title: z.string().describe("Imperative headline, at most 140 characters, no trailing period"),
  note: z.string().describe("Detail that is not in the title (speaker attribution, numbers, names not on the roster); empty string when none"),
  ownerInitials: z.string().nullable().describe("Roster initials of the owner (A/Q/I/W) or target (NB); null when nobody on the roster is named"),
  divisionCode: z.string().nullable().describe("A division code from the user message, or null"),
  initiativeName: z.string().nullable().describe("Initiative named in the text, or null"),
  priority: z.enum(PRIORITIES).describe('"Low", "Medium" (default) or "High"'),
  status: z.enum(STATUSES).describe('"Open" (default), "In Progress", "Parked" or "Done" (default for decisions)'),
  dueDate: z.string().nullable().describe("YYYY-MM-DD resolved from the Today date, or null"),
  isPersonal: z.boolean().describe("True for Brandon's personal to-dos (PTD)"),
  confidence: z.number().min(0).max(1).describe("0..1; inferred items at most 0.7"),
  inferred: z.boolean().describe("True when the source carried no explicit tag and the category was inferred"),
  sourceExcerpt: z.string().nullable().describe("The exact line(s) this came from"),
  warnings: z.array(z.string()).describe('Reviewer flags such as "unknown person: Brooke" or "NB needs a target"'),
});

export const ExtractionSchema = z.object({
  proposals: z.array(ExtractedProposalSchema),
  notes: z.array(z.string()).describe("A few short notes for the reviewer; do not restate the proposals"),
});

export type ExtractedProposal = z.infer<typeof ExtractedProposalSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionSchema>;
