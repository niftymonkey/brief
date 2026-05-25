import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifyResult as GatewayClassifyResult, LlmGatewayClient, VisionDescribeResult as GatewayVisionDescribeResult } from "../llm-gateway";
import { createGatewayVisionClient } from "./vision";

/**
 * Stub `LlmGatewayClient` that returns scripted results. Records every call's
 * frame bytes so tests can verify the file was read from disk before being
 * forwarded to the gateway.
 */
interface StubGatewayConfig {
  classifyResults?: GatewayClassifyResult[];
  describeResults?: GatewayVisionDescribeResult[];
}

function stubGateway(config: StubGatewayConfig = {}): LlmGatewayClient & {
  classifyCalls: Buffer[];
  describeCalls: Buffer[];
} {
  const classifyCalls: Buffer[] = [];
  const describeCalls: Buffer[] = [];
  let classifyIdx = 0;
  let describeIdx = 0;
  return {
    classifyCalls,
    describeCalls,
    async classify(frame) {
      classifyCalls.push(frame);
      const r = config.classifyResults?.[classifyIdx++];
      if (!r) throw new Error(`stubGateway: no scripted classify result #${classifyIdx}`);
      return r;
    },
    async describe(frame) {
      describeCalls.push(frame);
      const r = config.describeResults?.[describeIdx++];
      if (!r) throw new Error(`stubGateway: no scripted describe result #${describeIdx}`);
      return r;
    },
  };
}

function writeTempFrame(bytes: Buffer): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vision-test-"));
  const path = join(dir, "frame.png");
  writeFileSync(path, bytes);
  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

describe("createGatewayVisionClient.classify", () => {
  it("throws when the gateway returns kind=failed so the orchestrator's existing catch handles it", async () => {
    const { path, cleanup } = writeTempFrame(Buffer.from("frame"));
    try {
      const gateway = stubGateway({
        classifyResults: [
          { kind: "failed", reason: "rate-limited", message: "openrouter 429" },
        ],
      });
      const client = createGatewayVisionClient(gateway);

      await expect(client.classify(path)).rejects.toThrow(/rate-limited.*openrouter 429/);
    } finally {
      cleanup();
    }
  });

  it("reads the PNG from disk, forwards bytes to gateway, returns success-shaped result on kind=ok", async () => {
    const frameBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const { path, cleanup } = writeTempFrame(frameBytes);
    try {
      const gateway = stubGateway({
        classifyResults: [
          {
            kind: "ok",
            verdict: "yes",
            inputTokens: 200,
            outputTokens: 1,
            ledgerId: "ledger_1",
            model: "openai/gpt-5.4-nano",
          },
        ],
      });
      const client = createGatewayVisionClient(gateway);

      const result = await client.classify(path);

      expect(gateway.classifyCalls).toHaveLength(1);
      expect(Array.from(gateway.classifyCalls[0])).toEqual(Array.from(frameBytes));
      expect(result.verdict).toBe("yes");
      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(1);
      expect(result.model).toBe("openai/gpt-5.4-nano");
    } finally {
      cleanup();
    }
  });
});

describe("createGatewayVisionClient.describe", () => {
  it("reads PNG, forwards to gateway.describe, returns mode + description on kind=ok", async () => {
    const frameBytes = Buffer.from([0x89, 0x50]);
    const { path, cleanup } = writeTempFrame(frameBytes);
    try {
      const gateway = stubGateway({
        describeResults: [
          {
            kind: "ok",
            description: "[Editor] const x = 1",
            mode: "verbatim",
            inputTokens: 800,
            outputTokens: 120,
            ledgerId: "ledger_2",
            model: "openai/gpt-5.5",
          },
        ],
      });
      const client = createGatewayVisionClient(gateway);

      const result = await client.describe(path);

      expect(gateway.describeCalls).toHaveLength(1);
      expect(Array.from(gateway.describeCalls[0])).toEqual(Array.from(frameBytes));
      expect(result.description).toContain("const x = 1");
      expect(result.mode).toBe("verbatim");
      expect(result.inputTokens).toBe(800);
      expect(result.outputTokens).toBe(120);
      expect(result.model).toBe("openai/gpt-5.5");
    } finally {
      cleanup();
    }
  });

  it("throws when the gateway returns kind=failed", async () => {
    const { path, cleanup } = writeTempFrame(Buffer.from("frame"));
    try {
      const gateway = stubGateway({
        describeResults: [
          { kind: "failed", reason: "transient", message: "upstream-unavailable" },
        ],
      });
      const client = createGatewayVisionClient(gateway);

      await expect(client.describe(path)).rejects.toThrow(/transient.*upstream-unavailable/);
    } finally {
      cleanup();
    }
  });
});

describe("createGatewayVisionClient model accessors", () => {
  it("classifierModel + visionModel start empty and reflect the most recently observed model after each call", async () => {
    const { path, cleanup } = writeTempFrame(Buffer.from("frame"));
    try {
      const gateway = stubGateway({
        classifyResults: [
          { kind: "ok", verdict: "yes", inputTokens: 1, outputTokens: 1, ledgerId: "l1", model: "model-a" },
        ],
        describeResults: [
          {
            kind: "ok",
            description: "x",
            mode: "summary",
            inputTokens: 1,
            outputTokens: 1,
            ledgerId: "l2",
            model: "model-b",
          },
        ],
      });
      const client = createGatewayVisionClient(gateway);

      expect(client.classifierModel).toBe("");
      expect(client.visionModel).toBe("");

      await client.classify(path);
      expect(client.classifierModel).toBe("model-a");
      expect(client.visionModel).toBe("");

      await client.describe(path);
      expect(client.visionModel).toBe("model-b");
    } finally {
      cleanup();
    }
  });
});
