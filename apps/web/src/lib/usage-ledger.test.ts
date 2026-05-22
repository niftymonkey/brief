import { describe, it, expect } from "vitest";
import {
  createInMemoryUsageLedger,
  type UsageCall,
} from "./usage-ledger";

const sampleCall: UsageCall = {
  userId: "user_01",
  op: "classify",
  model: "openai/gpt-5.4-nano",
  inputTokens: 200,
  outputTokens: 5,
  latencyMs: 412,
};

describe("UsageLedger (in-memory adapter)", () => {
  describe("record", () => {
    it("returns a ledger id", async () => {
      const ledger = createInMemoryUsageLedger();
      const id = await ledger.record(sampleCall);
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("records a row with the call's fields and a computed cost", async () => {
      const ledger = createInMemoryUsageLedger();
      const id = await ledger.record(sampleCall);
      const rows = ledger.rows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id,
        userId: "user_01",
        op: "classify",
        model: "openai/gpt-5.4-nano",
        inputTokens: 200,
        outputTokens: 5,
        latencyMs: 412,
      });
      expect(rows[0]?.costUsd).toBeGreaterThan(0);
      expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    });

    it("assigns unique ids across calls", async () => {
      const ledger = createInMemoryUsageLedger();
      const a = await ledger.record(sampleCall);
      const b = await ledger.record(sampleCall);
      expect(a).not.toBe(b);
    });
  });

  describe("summarize", () => {
    it("aggregates input/output tokens, cost, and call count for the user since the cutoff", async () => {
      const ledger = createInMemoryUsageLedger();
      await ledger.record({ ...sampleCall, inputTokens: 100, outputTokens: 10 });
      await ledger.record({ ...sampleCall, inputTokens: 300, outputTokens: 20 });
      const summary = await ledger.summarize("user_01", new Date(0));
      expect(summary.inputTokens).toBe(400);
      expect(summary.outputTokens).toBe(30);
      expect(summary.calls).toBe(2);
      expect(summary.costUsd).toBeGreaterThan(0);
    });

    it("filters by userId", async () => {
      const ledger = createInMemoryUsageLedger();
      await ledger.record({ ...sampleCall, userId: "user_01", inputTokens: 100 });
      await ledger.record({ ...sampleCall, userId: "user_02", inputTokens: 999 });
      const summary = await ledger.summarize("user_01", new Date(0));
      expect(summary.inputTokens).toBe(100);
      expect(summary.calls).toBe(1);
    });

    it("excludes rows recorded before the since cutoff", async () => {
      let now = new Date("2026-05-22T00:00:00Z");
      const ledger = createInMemoryUsageLedger({ clock: () => now });

      await ledger.record({ ...sampleCall, inputTokens: 100 });

      const cutoff = new Date("2026-05-22T01:00:00Z");
      now = new Date("2026-05-22T02:00:00Z");
      await ledger.record({ ...sampleCall, inputTokens: 200 });

      const summary = await ledger.summarize("user_01", cutoff);
      expect(summary.inputTokens).toBe(200);
      expect(summary.calls).toBe(1);
    });

    it("returns zeros when no rows match", async () => {
      const ledger = createInMemoryUsageLedger();
      const summary = await ledger.summarize("user_01", new Date(0));
      expect(summary).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        calls: 0,
      });
    });
  });
});
