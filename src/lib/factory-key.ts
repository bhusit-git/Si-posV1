import { cookies } from "next/headers";
import { FACTORY_COOKIE, getFactories } from "@/db";

export async function resolveActiveFactoryKey(
  cookieFactoryKey?: string | null,
  sessionFactoryKey?: string | null
): Promise<string> {
  if (sessionFactoryKey) return sessionFactoryKey;

  const availableFactories = getFactories();
  const validKeys = new Set(availableFactories.map((factory) => factory.key));

  if (cookieFactoryKey && validKeys.has(cookieFactoryKey)) {
    return cookieFactoryKey;
  }

  try {
    const cookieStore = await cookies();
    const nextCookieFactoryKey = cookieStore.get(FACTORY_COOKIE)?.value;
    if (nextCookieFactoryKey && validKeys.has(nextCookieFactoryKey)) {
      return nextCookieFactoryKey;
    }
  } catch {
    // Ignore missing request context and fall back to the default factory.
  }

  return availableFactories[0]?.key || "default";
}
