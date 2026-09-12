import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drainTriggerEvents, normalizeTriggerEvent, publishTriggerEvent, triggerMatchesEvent } from "../bin/metor-trigger-events.mjs";
import { addEventRoutine } from "../bin/metor-routines.mjs";

test("normalizes and matches canonical events", () => {
  const incoming = normalizeTriggerEvent({ id: "delivery-1", source: "github", type: "pr.merged", subject: { repo: "metor-com/metor", number: 42 } });
  assert.equal(triggerMatchesEvent({ type: "event", source: "github", event: ["pr.merged", "ci.failed"], match: { "subject.repo": "metor-com/metor", "subject.number": 42 } }, incoming), true);
  assert.equal(triggerMatchesEvent({ type: "event", source: "github", event: "ci.failed" }, incoming), false);
});

test("durably dispatches matching routines once", () => {
  const root = mkdtempSync(join(tmpdir(), "metor-events-"));
  const botDir = join(root, "watcher", ".metor"); mkdirSync(botDir, { recursive: true });
  writeFileSync(join(botDir, "routines.json"), JSON.stringify({ v: 1, routines: [
    { id: "r1", name: "Merged", enabled: true, prompt: "Report it", trigger: { type: "event", source: "github", event: "pr.merged", match: { "subject.repo": "metor-com/metor" } } },
    { id: "r2", name: "Other", enabled: true, prompt: "No", trigger: { type: "event", source: "slack", event: "message" } },
  ] }));
  publishTriggerEvent(root, { id: "delivery-1", source: "github", type: "pr.merged", subject: { repo: "metor-com/metor" } });
  const calls = [];
  assert.equal(drainTriggerEvents(root, [{ name: "watcher" }], (bot, routine, incoming) => calls.push([bot.name, routine.id, incoming.id])).length, 1);
  assert.deepEqual(calls, [["watcher", "r1", "delivery-1"]]);
  assert.equal(drainTriggerEvents(root, [{ name: "watcher" }], () => assert.fail("duplicate delivery")).length, 0);
});

test("creates an event routine without scheduling a clock run", () => {
  const root = mkdtempSync(join(tmpdir(), "metor-event-routine-"));
  mkdirSync(join(root, "watcher"), { recursive: true });
  const result = addEventRoutine(root, "watcher", { name: "CI", source: "github", event: "ci.failed", match: { "subject.repo": "metor-com/metor" }, prompt: "Investigate" });
  assert.equal(result.routine.trigger.type, "event");
  assert.equal(result.routine.nextRunAt, null);
});
