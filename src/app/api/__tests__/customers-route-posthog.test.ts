import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOfficeUp: vi.fn(),
  requireManagerUp: vi.fn(),
  validateBody: vi.fn(),
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
  logAudit: vi.fn(),
  withBehaviorDetails: vi.fn((details: unknown) => details),
  resolveActiveFactoryKey: vi.fn(),
  getPostHogClient: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
  requireOfficeUp: mocks.requireOfficeUp,
}));

vi.mock("@/lib/validations", () => ({
  createCustomerSchema: {},
  updateCustomerSchema: {},
  validateBody: mocks.validateBody,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
  withBehaviorDetails: mocks.withBehaviorDetails,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

import { POST } from "@/app/api/customers/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("customer creation telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 8, username: "office", role: "office", factoryKey: "si" },
    });
    mocks.validateBody.mockReturnValue({
      data: {
        name: "SI Customer",
        phone: "0812345678",
        credit: true,
        transferCustomer: false,
        prices: [
          { productTypeId: 1, unitPrice: 120, bagDeposit: 0 },
          { productTypeId: 2, unitPrice: 0, bagDeposit: 0 },
        ],
      },
    });
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("emits customer.created after the database transaction succeeds", async () => {
    let insertCount = 0;
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertCount += 1;
          if (insertCount === 1) {
            expect(values).toMatchObject({
              name: "SI Customer",
              phone: "0812345678",
              credit: true,
              transferCustomer: false,
            });
            return {
              returning: vi.fn(async () => [{ id: 77 }]),
            };
          }
          return Promise.resolve(undefined);
        }),
      })),
      query: {
        productTypes: {
          findMany: vi.fn(),
        },
      },
    };
    const db = {
      transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
        callback(tx)
      ),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(makeRequest({}));
    const body = (await res.json()) as { id: number };

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: 77 });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:8",
        event: "customer.created",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 8,
          actor_role: "office",
          customer_id: 77,
          credit_enabled: true,
          transfer_customer: false,
          price_rows_count: 2,
          priced_product_count: 1,
        }),
      })
    );
  });
});
