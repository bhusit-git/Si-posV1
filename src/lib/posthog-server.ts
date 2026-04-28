import { PostHog } from "posthog-node";
import { getSupericeEnv } from "@/lib/config/env";

let posthogClient: PostHog | null = null;

const noop = () => {};
type PostHogCapturePayload = Parameters<PostHog["capture"]>[0];

const noopClient = {
  capture: noop,
  identify: noop,
  shutdown: () => Promise.resolve(),
} as unknown as PostHog;

function normalizeEventName(event: unknown): string | null {
  if (typeof event !== "string") return null;
  const trimmed = event.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getPostHogClient(): PostHog {
  const env = getSupericeEnv();
  const key = env.posthogKey;
  if (!key) return noopClient;

  if (!posthogClient) {
    posthogClient = new PostHog(key, {
      host: env.posthogHost,
      flushAt: 1,
      flushInterval: 0,
      before_send: (eventMessage) => {
        if (!eventMessage) return null;

        const eventName = normalizeEventName(eventMessage.event);
        if (!eventName) {
          console.warn("[analytics] dropping PostHog event with missing event name", {
            distinctId: eventMessage.distinctId,
            propertiesKeys: Object.keys(eventMessage.properties || {}),
          });
          return null;
        }

        return {
          ...eventMessage,
          event: eventName,
        };
      },
    });
    if (!env.isProduction) {
      posthogClient.debug(true);
    }
  }
  return posthogClient;
}

export async function shutdownPostHog() {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
}

export function capturePostHogEventSafe(
  payload: PostHogCapturePayload
): void {
  const eventName = normalizeEventName(payload?.event);
  if (!eventName) {
    console.warn("[analytics] skipping PostHog capture with missing event name", {
      distinctId: payload?.distinctId,
      propertiesKeys: Object.keys(payload?.properties || {}),
    });
    return;
  }

  try {
    getPostHogClient().capture({
      ...payload,
      event: eventName,
    });
  } catch (error) {
    console.warn(`[analytics] failed to capture ${eventName}`, error);
  }
}
