import { NextRequest } from "next/server";

export const REPORT_TIMEZONE = "Asia/Bangkok";
export const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export function getDateInTimezone(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Failed to resolve timezone date");
  }
  return `${year}-${month}-${day}`;
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfIsoWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function getPreviousCompletedIsoWeekRange(referenceDate: string): {
  weekStart: string;
  weekEnd: string;
  previousWeekStart: string;
  previousWeekEnd: string;
} {
  const currentWeekStart = startOfIsoWeek(referenceDate);
  const weekEnd = shiftDate(currentWeekStart, -1);
  const weekStart = shiftDate(weekEnd, -6);
  const previousWeekEnd = shiftDate(weekStart, -1);
  const previousWeekStart = shiftDate(previousWeekEnd, -6);

  return {
    weekStart,
    weekEnd,
    previousWeekStart,
    previousWeekEnd,
  };
}

export function readCronToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return (
    request.headers.get("x-cron-token") ||
    request.nextUrl.searchParams.get("key") ||
    null
  );
}

export function parseDryRun(request: NextRequest): boolean {
  const query = request.nextUrl.searchParams.get("dryRun");
  const header = request.headers.get("x-dry-run");
  return query === "1" || header === "1" || header === "true";
}

export function parseTargets(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
}

export function parseFactoryKeys(input: string | undefined): string[] {
  return parseTargets(input).map((value) => value.toLowerCase());
}

export async function pushLineTextMessage(
  channelAccessToken: string,
  targetId: string,
  messageText: string
) {
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to: targetId,
      messages: [{ type: "text", text: messageText }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE push failed for ${targetId}: ${response.status} ${body}`);
  }
}
