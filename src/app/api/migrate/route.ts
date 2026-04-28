import { type NextRequest } from "next/server";
import { dispatchMigrateAction } from "@/lib/migrate/dispatcher";
import { authorizeMigrationRequest } from "@/lib/migrate/shared";

export async function GET(request: NextRequest) {
  const auth = authorizeMigrationRequest(request);
  if (!auth.ok) return auth.response;
  return dispatchMigrateAction(request, auth.callerIp);
}

export async function POST(request: NextRequest) {
  const auth = authorizeMigrationRequest(request);
  if (!auth.ok) return auth.response;
  return dispatchMigrateAction(request, auth.callerIp);
}
