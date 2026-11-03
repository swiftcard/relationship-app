import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "@/lib/crew/llm/anthropic";
import { OpenAiCritic } from "@/lib/crew/llm/openai";
import { MODEL_ID } from "@/lib/crew/models";

const calls = vi.hoisted(() => ({ claude: vi.fn(), critic: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {
  messages = { create: calls.claude };
  beta = { messages: { create: calls.claude } };
} }));
vi.mock("openai", () => ({ default: class { responses = { create: calls.critic }; } }));
beforeEach(() => {
  calls.claude.mockReset().mockResolvedValue({ model: MODEL_ID.haiku, content: [{ type: "text", text: "{}" }], usage: {}, stop_reason: "end_turn" });
  calls.critic.mockReset().mockResolvedValue({ model: "test", output_text: "{}", usage: {} });
});

describe("deadline transport options (no network)", () => {
  it.each([MODEL_ID.haiku, MODEL_ID.sonnet])("%s gets a bounded timeout without SDK retries", async (model) => {
    await new AnthropicProvider("test").create({ model, system: "s", prompt: "p", maxTokens: 400, effort: "low", timeoutMs: 12_000 });
    expect(calls.claude).toHaveBeenCalledWith(expect.any(Object), { timeout: 12_000, maxRetries: 0 });
  });

  it("the existing optional reviewer honors the same timeout without retries", async () => {
    await new OpenAiCritic("test", "test").critique("s", "p", {}, 8000);
    expect(calls.critic).toHaveBeenCalledWith(expect.any(Object), { timeout: 8000, maxRetries: 0 });
  });

  it("keeps provider defaults for callers without a lead-run deadline", async () => {
    await new AnthropicProvider("test").create({ model: MODEL_ID.haiku, system: "s", prompt: "p", maxTokens: 400, effort: "low" });
    expect(calls.claude).toHaveBeenCalledWith(expect.any(Object), undefined);
  });
});
