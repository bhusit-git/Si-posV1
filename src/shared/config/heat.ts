import { readOptionalEnv } from "./internal";
import { getSharedDbEnv } from "./shared-db";

export function getHeatEnv() {
  const sharedDbEnv = getSharedDbEnv();

  return {
    ...sharedDbEnv,
    mlArtifactsRoot: readOptionalEnv("ML_ARTIFACTS_ROOT"),
  };
}
