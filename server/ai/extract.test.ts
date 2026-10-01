import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import type { Capture } from "../../shared/types";
import type { ExtractContext, ExtractInput } from "../contracts";
import { call, exampleDivisions, examplePeople, json, makeTestApp } from "../lib/testing";
import {
  AI_NOT_CONFIGURED_NOTE,
  MAX_TOKENS,
  REFUSAL_NOTE,
  RULE_PARSER_MODEL,
  buildRequest,
  createExtractor,
  translateApiError,
  type ExtractParseParams,
  type ExtractParseResponse,
} from "./extract";
import { ADDED_BY_RULE_WARNING } from "./grammar";
import { STABLE_SYSTEM_PROMPT } from "./prompt";
import type { ExtractedProposal, ExtractionOutput } from "./schema";

const MODEL = "claude-opus-5-5";
const TODAY = "2026-09-30";
const ctx: ExtractContext = {
  people: examplePeople,
  divisions: exampleDivisions,
  initiatives: [{ id: 1, name: "BAU", status: "Active", createdAt: "2026-01-01T00:00:00.000Z" }],
};

function input(overrides: Partial<ExtractInput> = {}): ExtractInput {
  return { text: null, images: [], context: null, defaultDivisionCode: null, todayISO: TODAY, ...overrides };
}

function proposal(overrides: Partial<ExtractedProposal> = {}): ExtractedProposal {
  return {
    category: "A",
    title: "Call Vince about the install",
    note: "",
    ownerInitials: "VM",
    divisionCode: "HG",
    initiativeName: null,
    priority: "Medium",
    status: "Open",
    dueDate: null,
    isPersonal: false,
    confidence: 0.95,
    inferred: false,
    sourceExcerpt: "A: VM call Vince about the HG install",
    warnings: [],
    ...overrides,
  };
}

function response(parsed: ExtractionOutput | null, overrides: Partial<ExtractParseResponse> = {}): ExtractParseResponse {
  return {
    stop_reason: "end_turn",
    stop_details: null,
    parsed_output: parsed,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    model: MODEL,
    ...overrides,
  };
}

type Handler = (params: ExtractParseParams, call: number) => ExtractParseResponse | Promise<ExtractParseResponse>;

function fakeClient(handler: Handler) {
  const calls: ExtractParseParams[] = [];
  const client = {
    messages: {
      parse: async (params: ExtractParseParams): Promise<ExtractParseResponse> => {
        calls.push(params);
        return handler(params, calls.length);
      },
    },
  };
  return { client, calls };
}

const TEXT = "A: VM call Vince about the HG install\nQ: DK what is the plan for K&B-I?";

describe("createExtractor — request shape", () => {
  it("sends the cached system prompt, images before text, structured output and no thinking / tool_choice", async () => {
    const { client, calls } = fakeClient(() => response({ proposals: [proposal()], notes: [] }));
    const extract = createExtractor({ apiKey: "sk-test", model: MODEL, client });
    const png = { filename: "IMG_1.PNG", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) };
    const jpg = { filename: "photo.jpg", mime: "image/jpeg", bytes: new Uint8Array([4, 5]) };
    await extract(input({ text: TEXT, images: [png, jpg], context: "1:1 with VM", defaultDivisionCode: "HG" }), ctx);

    assert.equal(calls.length, 1);
    const params = calls[0];
    assert.ok(params);
    assert.equal(params.model, MODEL);
    assert.equal(params.max_tokens, MAX_TOKENS);
    assert.equal(Object.hasOwn(params, "thinking"), false, "thinking must be omitted");
    assert.equal(Object.hasOwn(params, "tool_choice"), false, "tool_choice must be omitted");
    assert.equal(Object.hasOwn(params, "tools"), false);
    assert.ok(Array.isArray(params.system));
    const system = params.system[0];
    assert.ok(system);
    assert.equal(system.text, STABLE_SYSTEM_PROMPT);
    assert.deepEqual(system.cache_control, { type: "ephemeral" });
    assert.equal(params.output_config.effort, "medium");
    assert.equal(params.output_config.format.type, "json_schema");
    assert.equal(typeof params.output_config.format.parse, "function");
    const schema = params.output_config.format.schema as { properties?: Record<string, unknown>; required?: string[] };
    assert.ok(schema.properties?.proposals);
    assert.deepEqual(schema.required, ["proposals", "notes"]);

    const message = params.messages[0];
    assert.ok(message && Array.isArray(message.content));
    const content = message.content;
    assert.equal(content.length, 3);
    assert.equal(content[0]?.type, "image");
    assert.equal(content[1]?.type, "image");
    assert.equal(content[2]?.type, "text");
    const first = content[0];
    assert.ok(first && first.type === "image" && first.source.type === "base64");
    assert.equal(first.source.media_type, "image/png");
    assert.equal(first.source.data, Buffer.from([1, 2, 3]).toString("base64"));
    const textBlock = content[2];
    assert.ok(textBlock && textBlock.type === "text");
    assert.match(textBlock.text, /## Roster[\s\S]*VM → Vincent Moynihan → HG/);
    assert.match(textBlock.text, /## Today\n2026-09-30 \(Wednesday\)/);
    assert.match(textBlock.text, /## Context\n1:1 with VM/);
    assert.match(textBlock.text, /## Default division\nHG — Henderson Glass/);
    assert.match(textBlock.text, /IMG_1.PNG, photo.jpg/);
    assert.match(textBlock.text, /<capture>\nA: VM call Vince about the HG install\nQ: DK what is the plan for K&B-I\?\n<\/capture>/);
  });

  it("skips unsupported or oversized images with a note and keeps the rest", () => {
    const built = buildRequest(MODEL, input({ text: "A: VM x", images: [
      { filename: "IMG_2.HEIC", mime: "image/heic", bytes: new Uint8Array(3) },
      { filename: "big.png", mime: "image/png", bytes: new Uint8Array(5 * 1024 * 1024 + 1) },
      { filename: "ok.webp", mime: "image/webp", bytes: new Uint8Array(3) },
    ] }), ctx);
    assert.deepEqual(built.attachedImages, ["ok.webp"]);
    assert.equal(built.skippedImages.length, 2);
    assert.match(built.skippedImages[0] ?? "", /IMG_2.HEIC.*not supported/);
    assert.match(built.skippedImages[1] ?? "", /big.png.*5 MB/);
    const content = built.params.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 2);
    assert.match((content[1] as { text: string }).text, /## Attached images\n1 image\(s\), in order: ok.webp/);
  });
});

describe("createExtractor — results", () => {
  it("merges the model output with the rule parser and scrubs unknown codes", async () => {
    const { client, calls } = fakeClient(() =>
      response({
        proposals: [
          proposal(),
          proposal({ category: "W", title: "Watch the receivables", ownerInitials: "Brooke", divisionCode: "XYZ", inferred: true, confidence: 0.9, sourceExcerpt: "she said watch the receivables" }),
        ],
        notes: ["model note"],
      }),
    );
    const extract = createExtractor({ apiKey: null, model: MODEL, client });
    const result = await extract(input({ text: TEXT }), ctx);

    assert.equal(calls.length, 1);
    assert.equal(result.model, MODEL);
    assert.deepEqual(result.usage, { input: 1100, output: 50 });
    assert.equal(result.proposals.length, 3);
    const [first, second, third] = result.proposals;
    assert.equal(first?.draft.ownerInitials, "VM");
    assert.equal(first?.draft.divisionCode, "HG");
    assert.equal(first?.inferred, false);
    assert.equal(second?.draft.ownerInitials, null);
    assert.equal(second?.draft.divisionCode, null);
    assert.equal(second?.confidence, 0.7);
    assert.deepEqual(second?.warnings, ["unknown person: Brooke", "unknown division: XYZ"]);
    assert.equal(third?.draft.category, "Q");
    assert.equal(third?.draft.ownerInitials, "DK");
    assert.deepEqual(third?.warnings, [ADDED_BY_RULE_WARNING]);
    assert.deepEqual(result.notes, ["model note", "Rule parser added 1 tagged line(s) the model left out"]);
  });

  it("returns zero proposals with a note on a refusal", async () => {
    const { client, calls } = fakeClient(() => response(null, { stop_reason: "refusal", stop_details: { category: null, explanation: "policy" } }));
    const extract = createExtractor({ apiKey: null, model: MODEL, client });
    const result = await extract(input({ text: TEXT }), ctx);
    assert.equal(calls.length, 1, "no retry on refusal");
    assert.deepEqual(result.proposals, []);
    assert.equal(result.notes[0], `${REFUSAL_NOTE}: policy`);
    assert.equal(result.model, MODEL);
  });

  it("retries once when parsed_output is null, then succeeds", async () => {
    const { client, calls } = fakeClient((_params, n) => (n === 1 ? response(null, { stop_reason: "max_tokens" }) : response({ proposals: [proposal()], notes: [] })));
    const extract = createExtractor({ apiKey: null, model: MODEL, client });
    const result = await extract(input({ text: "A: VM call Vince about the HG install" }), ctx);
    assert.equal(calls.length, 2);
    assert.equal(result.proposals.length, 1);
    assert.deepEqual(result.usage, { input: 2200, output: 100 }, "usage is summed over both attempts");
  });

  it("throws a readable error when the answer is unreadable twice", async () => {
    const { client, calls } = fakeClient(() => response(null, { stop_reason: "max_tokens" }));
    const extract = createExtractor({ apiKey: null, model: MODEL, client });
    await assert.rejects(extract(input({ text: TEXT }), ctx), /could not be read as proposals \(the answer was cut off at the token limit\) after two attempts/);
    assert.equal(calls.length, 2);
  });

  it("treats a structured-output validation failure like an unreadable answer (retry once)", async () => {
    const { client, calls } = fakeClient((_params, n) => {
      if (n === 1) throw new Anthropic.AnthropicError("Failed to parse structured output: bad enum");
      return response({ proposals: [proposal()], notes: [] });
    });
    const extract = createExtractor({ apiKey: null, model: MODEL, client });
    const result = await extract(input({ text: "A: VM call Vince about the HG install" }), ctx);
    assert.equal(calls.length, 2);
    assert.equal(result.proposals.length, 1);

    const always = fakeClient(() => {
      throw new Anthropic.AnthropicError("Failed to parse structured output: bad enum");
    });
    await assert.rejects(createExtractor({ apiKey: null, model: MODEL, client: always.client })(input({ text: TEXT }), ctx), /could not be read as proposals \(Failed to parse structured output: bad enum\)/);
  });

  it("maps SDK errors to plain-English messages", async () => {
    const headers = new Headers();
    const body = (type: string, message: string) => ({ type: "error", error: { type, message } });
    const cases: [unknown, RegExp][] = [
      [new Anthropic.AuthenticationError(401, body("authentication_error", "invalid x-api-key"), "invalid x-api-key", headers), /API key.*401/],
      [new Anthropic.RateLimitError(429, body("rate_limit_error", "slow down"), "slow down", headers), /rate limit.*429/i],
      [new Anthropic.APIError(529, body("overloaded_error", "Overloaded"), "Overloaded", headers), /overloaded.*529/i],
      [new Anthropic.APIError(400, body("invalid_request_error", "max_tokens too large"), "400 bad", headers), /rejected the request \(400\): max_tokens too large/],
      [new Anthropic.NotFoundError(404, body("not_found_error", "model: nope"), "nope", headers), /Model "claude-opus-5-5" was not found/],
      [new Anthropic.InternalServerError(500, body("api_error", "Internal"), "Internal", headers), /Anthropic API error 500: Internal/],
      [new Anthropic.APIConnectionError({ message: "fetch failed" }), /Could not reach the Anthropic API/],
      [new Anthropic.APIConnectionTimeoutError({ message: "timeout" }), /timed out/],
    ];
    for (const [err, expected] of cases) {
      const translated = translateApiError(err, MODEL);
      assert.ok(translated, `expected a translation for ${String(err)}`);
      assert.match(translated.message, expected);
      const { client } = fakeClient(() => {
        throw err;
      });
      await assert.rejects(createExtractor({ apiKey: null, model: MODEL, client })(input({ text: TEXT }), ctx), expected);
    }
    assert.equal(translateApiError(new TypeError("boom"), MODEL), null);
  });

  it("rethrows non-SDK errors untouched", async () => {
    const boom = new TypeError("boom");
    const { client } = fakeClient(() => {
      throw boom;
    });
    await assert.rejects(createExtractor({ apiKey: null, model: MODEL, client })(input({ text: TEXT }), ctx), (err: unknown) => err === boom);
  });

  it("does not call the model when there is nothing it can analyse", async () => {
    const { client, calls } = fakeClient(() => response({ proposals: [proposal()], notes: [] }));
    const extract = createExtractor({ apiKey: null, model: MODEL, client });
    const result = await extract(input({ images: [{ filename: "IMG_2.HEIC", mime: "image/heic", bytes: new Uint8Array(3) }] }), ctx);
    assert.equal(calls.length, 0);
    assert.deepEqual(result.proposals, []);
    assert.equal(result.model, MODEL);
    assert.match(result.notes[0] ?? "", /IMG_2.HEIC.*not supported/);
    assert.match(result.notes[1] ?? "", /Nothing the model could analyse/);
  });

  it("adds a note when the model finds nothing actionable", async () => {
    const { client } = fakeClient(() => response({ proposals: [], notes: [] }));
    const result = await createExtractor({ apiKey: null, model: MODEL, client })(input({ text: "just chatting about the weather" }), ctx);
    assert.deepEqual(result.proposals, []);
    assert.deepEqual(result.notes, ["Nothing actionable found"]);
  });

  it("rejects an injected client without messages.parse and defaults an empty model id", () => {
    assert.throws(() => createExtractor({ apiKey: null, model: MODEL, client: { messages: {} } }), /messages\.parse/);
    const { client, calls } = fakeClient(() => response({ proposals: [], notes: [] }));
    return createExtractor({ apiKey: null, model: "  ", client })(input({ text: "hi" }), ctx).then(() => assert.equal(calls[0]?.model, "claude-opus-5-5"));
  });
});

describe("createExtractor — no API key", () => {
  it("runs only the rule parser and says so", async () => {
    const extract = createExtractor({ apiKey: null, model: MODEL });
    const result = await extract(input({ text: TEXT, images: [{ filename: "a.png", mime: "image/png", bytes: new Uint8Array(1) }], defaultDivisionCode: "HG" }), ctx);
    assert.equal(result.model, RULE_PARSER_MODEL);
    assert.equal(result.usage, undefined);
    assert.equal(result.proposals.length, 2);
    assert.equal(result.proposals[0]?.draft.title, "Call Vince about the install");
    assert.equal(result.proposals[0]?.confidence, 0.95);
    assert.equal(result.proposals[1]?.draft.divisionCode, "K&B-I");
    assert.deepEqual(result.notes, [AI_NOT_CONFIGURED_NOTE, "1 image(s) stored but not analysed (AI not configured)"]);

    const none = await extract(input({ text: "nothing tagged here" }), ctx);
    assert.deepEqual(none.proposals, []);
    assert.deepEqual(none.notes, [AI_NOT_CONFIGURED_NOTE, "No tagged lines (A:, Q:, I:, D:, W:, NB:) found"]);

    const empty = await extract(input({ text: "   " }), ctx);
    assert.deepEqual(empty.proposals, []);
    assert.deepEqual(empty.notes, [AI_NOT_CONFIGURED_NOTE]);
  });
});

describe("createExtractor — through the API", () => {
  it("stores merged proposals and notes on a capture", async () => {
    const { client } = fakeClient(() => response({ proposals: [proposal()], notes: ["from the model"] }));
    const t = makeTestApp({}, { extractProposals: createExtractor({ apiKey: "sk-test", model: MODEL, client }) });
    const res = await call(t, "POST", "/api/captures", { text: TEXT, context: "1:1 with VM" });
    assert.equal(res.status, 201);
    const capture = await json<Capture>(res);
    assert.equal(capture.error, null);
    assert.equal(capture.proposals.length, 2);
    assert.equal(capture.proposals[0]?.draft.ownerInitials, "VM");
    assert.equal(capture.proposals[1]?.draft.category, "Q");
    assert.deepEqual(capture.proposals[1]?.warnings, [ADDED_BY_RULE_WARNING]);
    assert.deepEqual(capture.notes, ["from the model", "Rule parser added 1 tagged line(s) the model left out", `Model: ${MODEL}`]);
  });

  it("records the plain-English API error on the capture", async () => {
    const { client } = fakeClient(() => {
      throw new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
    });
    const t = makeTestApp({}, { extractProposals: createExtractor({ apiKey: "sk-test", model: MODEL, client }) });
    const capture = await json<Capture>(await call(t, "POST", "/api/captures", { text: TEXT }));
    assert.equal(capture.status, "pending");
    assert.match(capture.error ?? "", /rate limit reached \(429\)/);
    assert.equal(capture.proposals.length, 0);
  });

  it("falls back to the rule parser without a key", async () => {
    const t = makeTestApp({}, { extractProposals: createExtractor({ apiKey: null, model: MODEL }) });
    const capture = await json<Capture>(await call(t, "POST", "/api/captures", { text: TEXT }));
    assert.equal(capture.proposals.length, 2);
    assert.deepEqual(capture.notes, [AI_NOT_CONFIGURED_NOTE, `Model: ${RULE_PARSER_MODEL}`]);
  });
});
