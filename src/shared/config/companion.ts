import {
  isProduction,
  parsePositiveInt,
  readOptionalEnv,
  requireInProduction,
} from "./internal";
import { getSharedDbEnv } from "./shared-db";

const DEFAULT_COMPANION_SESSION_SECRET = "factory-companion-dev-secret-key-local-only";
const DEFAULT_OPENAI_MODEL = "gpt-5.2";
const DEFAULT_OPENAI_TIMEOUT_MS = 15_000;
const DEFAULT_OPENAI_MAX_TOOL_CALLS = 6;
const DEFAULT_LINE_CHAT_CONTEXT_TTL_MINUTES = 15;

export function getCompanionEnv() {
  const sharedDbEnv = getSharedDbEnv();

  return {
    isProduction: isProduction(),
    sessionSecret: requireInProduction(
      "COMPANION_SESSION_SECRET",
      readOptionalEnv("COMPANION_SESSION_SECRET"),
      DEFAULT_COMPANION_SESSION_SECRET
    ),
    ownerUsersJson: readOptionalEnv("OWNER_USERS_JSON"),
    companionFactoryKeys: readOptionalEnv("COMPANION_FACTORY_KEYS"),
    contextDatabaseUrl: sharedDbEnv.mainDatabaseUrl,
    lineAllowedUsersJson: readOptionalEnv("COMPANION_LINE_ALLOWED_USERS_JSON"),
    lineChannelSecret: readOptionalEnv("COMPANION_LINE_CHANNEL_SECRET"),
    lineChannelAccessToken: readOptionalEnv("COMPANION_LINE_CHANNEL_ACCESS_TOKEN"),
    lineChatContextTtlMinutes: parsePositiveInt(
      readOptionalEnv("LINE_CHAT_CONTEXT_TTL_MINUTES"),
      DEFAULT_LINE_CHAT_CONTEXT_TTL_MINUTES
    ),
    openAiApiKey: readOptionalEnv("OPENAI_API_KEY"),
    openAiModel: readOptionalEnv("OPENAI_MODEL") || DEFAULT_OPENAI_MODEL,
    openAiTimeoutMs: parsePositiveInt(
      readOptionalEnv("OPENAI_TIMEOUT_MS"),
      DEFAULT_OPENAI_TIMEOUT_MS
    ),
    openAiMaxToolCallsPerTurn: parsePositiveInt(
      readOptionalEnv("OPENAI_MAX_TOOL_CALLS_PER_TURN"),
      DEFAULT_OPENAI_MAX_TOOL_CALLS
    ),
    getFactoryDatabaseUrl(factoryKey: string): string | null {
      const upperFactoryKey = String(factoryKey || "").toUpperCase();
      return (
        readOptionalEnv(`COMPANION_DATABASE_URL_${upperFactoryKey}`) ||
        sharedDbEnv.getFactoryDatabaseUrl(factoryKey)
      );
    },
  };
}
