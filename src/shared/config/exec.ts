import { isProduction, readOptionalEnv, requireInProduction } from "./internal";
import { getSharedDbEnv } from "./shared-db";

const DEFAULT_EXEC_SESSION_SECRET = "exec-dashboard-dev-secret-local-only";
const DEFAULT_EXEC_PIN = "1234";

export function getExecEnv() {
  const sharedDbEnv = getSharedDbEnv();

  return {
    isProduction: isProduction(),
    sessionSecret: requireInProduction(
      "EXEC_SESSION_SECRET",
      readOptionalEnv("EXEC_SESSION_SECRET"),
      DEFAULT_EXEC_SESSION_SECRET
    ),
    pin: requireInProduction("EXEC_PIN", readOptionalEnv("EXEC_PIN"), DEFAULT_EXEC_PIN),
    siDatabaseUrl: sharedDbEnv.factoryDatabaseUrls.si,
  };
}
