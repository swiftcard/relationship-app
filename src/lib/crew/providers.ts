import { env, fakeLlmEnabled } from "./env";
import type { Providers } from "./context";
import { AnthropicProvider } from "./llm/anthropic";
import { FakeClaude, FakeCritic } from "./llm/fake";
import { OpenAiCritic } from "./llm/openai";

// Which models are connected right now. Missing keys mean "not connected",
// never a crash: an agent that needs Claude stops with "Needs: …".
export function liveProviders(): Providers {
  if (fakeLlmEnabled()) return { claude: new FakeClaude(), critic: new FakeCritic() };
  const anthropicKey = env("CREW_ANTHROPIC_API_KEY");
  const openAiKey = env("CREW_OPENAI_API_KEY");
  const openAiModel = env("CREW_OPENAI_MODEL");
  return {
    claude: anthropicKey ? new AnthropicProvider(anthropicKey) : null,
    critic: openAiKey && openAiModel ? new OpenAiCritic(openAiKey, openAiModel) : null,
  };
}
