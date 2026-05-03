import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supply/stock-engine", () => ({
  checkStockSufficiency: vi.fn(),
  writeStockLedger: vi.fn(),
}));

vi.mock("@/lib/supply/route-helpers", () => ({
  validateSupplyRequestTargetFactoryKey: vi.fn((requestType: string, targetFactoryKey: string | null, options?: { allowEmpty?: boolean }) => {
    if (requestType !== "cross_factory") {
      return { targetFactoryKey: null, error: null };
    }
    if (!targetFactoryKey) {
      return options?.allowEmpty
        ? { targetFactoryKey: null, error: null }
        : { targetFactoryKey: null, error: "กรุณาเลือกโรงงานต้นทางสำหรับการเบิกข้ามโรงงาน" };
    }
    if (targetFactoryKey === "bearng") {
      return { targetFactoryKey: null, error: "โรงงานต้นทางไม่ถูกต้อง" };
    }
    return { targetFactoryKey, error: null };
  }),
}));

import { supplyRequestItems, supplyRequests } from "@/db/schema";
import {
  approveRequest,
  fulfillRequest,
  rejectRequest,
  submitRequest,
  updateDraftRequest,
} from "@/lib/supply/request-engine";
import {
  checkStockSufficiency,
  writeStockLedger,
} from "@/lib/supply/stock-engine";

function buildRequest(overrides: Partial<typeof supplyRequests.$inferSelect> = {}) {
  return {
    id: 41,
    factoryKey: "si",
    requestType: "internal_factory" as const,
    targetFactoryKey: null,
    requesterName: "แผนกผลิต",
    createdBy: 7,
    status: "draft" as const,
    note: "เบิกใช้งานประจำวัน",
    approvedBy: null,
    approverSignature: null,
    approvedAt: null,
    fulfilledAt: null,
    createdAt: new Date("2026-04-30T01:00:00.000Z"),
    updatedAt: new Date("2026-04-30T01:00:00.000Z"),
    ...overrides,
  };
}

function buildRequestItem(
  overrides: Partial<typeof supplyRequestItems.$inferSelect> = {}
) {
  return {
    id: 1001,
    requestId: 41,
    supplyItemId: 3,
    quantityRequested: 5,
    quantityApproved: null,
    note: null,
    ...overrides,
  };
}

function createRequestDb(
  request: ReturnType<typeof buildRequest>,
  items: Array<ReturnType<typeof buildRequestItem>> = []
) {
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn((table) => {
        if (table === supplyRequests) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([request]),
            })),
          };
        }

        if (table === supplyRequestItems) {
          return {
            where: vi.fn(() => ({
              orderBy: vi.fn().mockResolvedValue(items),
            })),
          };
        }

        throw new Error("Unexpected select table");
      }),
    })),
    delete: vi.fn((table) => {
      if (table === supplyRequestItems) {
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      }

      throw new Error("Unexpected delete table");
    }),
    insert: vi.fn((table) => {
      if (table === supplyRequestItems) {
        return {
          values: vi.fn().mockResolvedValue(undefined),
        };
      }

      throw new Error("Unexpected insert table");
    }),
    update: vi.fn((table) => {
      if (table === supplyRequestItems) {
        return {
          set: vi.fn(() => ({
            where: vi.fn().mockResolvedValue(undefined),
          })),
        };
      }

      if (table === supplyRequests) {
        return {
          set: vi.fn((values) => ({
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([
                {
                  ...request,
                  ...values,
                },
              ]),
            })),
          })),
        };
      }

      throw new Error("Unexpected update table");
    }),
  };

  return {
    transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    tx,
  };
}

describe("request-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submitRequest transitions draft to pending", async () => {
    const request = buildRequest({ status: "draft" });
    const db = createRequestDb(request, [buildRequestItem()]);

    const result = await submitRequest(db as never, request.id, { id: 7 });

    expect(result.status).toBe("pending");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("submitRequest rejects incomplete drafts", async () => {
    const request = buildRequest({ status: "draft", requesterName: null });
    const db = createRequestDb(request, [buildRequestItem()]);

    await expect(submitRequest(db as never, request.id, { id: 7 })).rejects.toThrow(
      "กรุณาระบุผู้ขอใช้จริงก่อนส่งอนุมัติ"
    );
  });

  it("submitRequest rejects cross-factory drafts with invalid target factory", async () => {
    const request = buildRequest({
      status: "draft",
      requestType: "cross_factory",
      targetFactoryKey: "bearng",
    });
    const db = createRequestDb(request, [buildRequestItem()]);

    await expect(submitRequest(db as never, request.id, { id: 7 })).rejects.toThrow(
      "โรงงานต้นทางไม่ถูกต้อง"
    );
  });

  it("updateDraftRequest replaces header fields and items", async () => {
    const request = buildRequest({ status: "draft", requesterName: "แผนกผลิต" });
    const db = createRequestDb(request, [buildRequestItem()]);

    const result = await updateDraftRequest(db as never, request.id, {
      requestType: "internal_factory",
      targetFactoryKey: null,
      requesterName: "ทีมแพ็กกิ้ง",
      note: "ขอไว้ก่อนส่งอนุมัติ",
      items: [
        {
          supplyItemId: 8,
          quantityRequested: 24,
          note: "แบบแพ็ค",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "draft",
      requestType: "internal_factory",
      targetFactoryKey: null,
      requesterName: "ทีมแพ็กกิ้ง",
      note: "ขอไว้ก่อนส่งอนุมัติ",
    });
    expect(db.tx.delete).toHaveBeenCalledTimes(1);
    expect(db.tx.insert).toHaveBeenCalledTimes(1);
  });

  it("updateDraftRequest rejects invalid cross-factory target keys", async () => {
    const request = buildRequest({ status: "draft" });
    const db = createRequestDb(request, [buildRequestItem()]);

    await expect(
      updateDraftRequest(db as never, request.id, {
        requestType: "cross_factory",
        targetFactoryKey: "bearng",
        requesterName: "ทีมแพ็กกิ้ง",
        note: null,
        items: [],
      })
    ).rejects.toThrow("โรงงานต้นทางไม่ถูกต้อง");
  });

  it("approveRequest stores signature without moving stock yet", async () => {
    const request = buildRequest({ status: "pending" });
    const items = [
      buildRequestItem({ id: 1001, supplyItemId: 3, quantityRequested: 5 }),
      buildRequestItem({ id: 1002, supplyItemId: 4, quantityRequested: 2 }),
    ];
    const db = createRequestDb(request, items);

    vi.mocked(checkStockSufficiency).mockResolvedValue({
      sufficient: true,
      shortfalls: [],
    });
    vi.mocked(writeStockLedger).mockResolvedValue({
      id: 1,
      factoryKey: "si",
      supplyItemId: 3,
      type: "internal_use",
      quantity: -3,
      referenceId: request.id,
      referenceType: "request",
      note: request.note,
      createdBy: 9,
      createdAt: new Date("2026-04-30T09:00:00.000Z"),
    });

    const result = await approveRequest(
      db as never,
      request.id,
      { id: 9 },
      [
        { requestItemId: 1001, quantity: 3 },
        { requestItemId: 1002, quantity: 2 },
      ],
      " manager-pin "
    );

    expect(result.status).toBe("approved");
    expect(result.approvedBy).toBe(9);
    expect(result.approverSignature).toBe("manager-pin");
    expect(checkStockSufficiency).toHaveBeenCalledWith(
      db.tx,
      "si",
      [
        { supplyItemId: 3, quantity: 3 },
        { supplyItemId: 4, quantity: 2 },
      ]
    );
    expect(writeStockLedger).not.toHaveBeenCalled();
  });

  it("approveRequest fails when stock is insufficient", async () => {
    const request = buildRequest({ status: "pending" });
    const items = [buildRequestItem({ id: 1001, supplyItemId: 3, quantityRequested: 5 })];
    const db = createRequestDb(request, items);

    vi.mocked(checkStockSufficiency).mockResolvedValue({
      sufficient: false,
      shortfalls: [{ supplyItemId: 3, available: 1, requested: 5 }],
    });

    await expect(
      approveRequest(
        db as never,
        request.id,
        { id: 9 },
        [{ requestItemId: 1001, quantity: 5 }],
        "pin"
      )
    ).rejects.toThrow("Insufficient supply stock for approval");

    expect(writeStockLedger).not.toHaveBeenCalled();
  });

  it("approveRequest checks cross-factory stock against the source factory database", async () => {
    const request = buildRequest({
      status: "pending",
      requestType: "cross_factory",
      targetFactoryKey: "bearing",
    });
    const items = [buildRequestItem({ id: 1001, supplyItemId: 3, quantityRequested: 5 })];
    const db = createRequestDb(request, items);
    const sourceStockDb = { select: vi.fn() };

    vi.mocked(checkStockSufficiency).mockResolvedValue({
      sufficient: true,
      shortfalls: [],
    });

    const result = await approveRequest(
      db as never,
      request.id,
      { id: 9 },
      [{ requestItemId: 1001, quantity: 5 }],
      "pin",
      { stockDb: sourceStockDb as never }
    );

    expect(result.status).toBe("approved");
    expect(checkStockSufficiency).toHaveBeenCalledWith(sourceStockDb, "bearing", [
      { supplyItemId: 3, quantity: 5 },
    ]);
  });

  it("rejectRequest transitions pending to rejected and appends note", async () => {
    const request = buildRequest({ status: "pending", note: "เบิกด่วน" });
    const db = createRequestDb(request);

    const result = await rejectRequest(db as never, request.id, { id: 9 }, "ของไม่พอ");

    expect(result.status).toBe("rejected");
    expect(result.note).toBe("เบิกด่วน\nของไม่พอ");
  });

  it("fulfillRequest transitions approved to fulfilled", async () => {
    const request = buildRequest({
      status: "approved",
      approvedBy: 9,
      approverSignature: "pin",
      approvedAt: new Date("2026-04-30T09:00:00.000Z"),
    });
    const items = [
      buildRequestItem({ id: 1001, supplyItemId: 3, quantityRequested: 5, quantityApproved: 3 }),
      buildRequestItem({ id: 1002, supplyItemId: 4, quantityRequested: 2, quantityApproved: 2 }),
    ];
    const db = createRequestDb(request, items);

    vi.mocked(checkStockSufficiency).mockResolvedValue({
      sufficient: true,
      shortfalls: [],
    });
    vi.mocked(writeStockLedger).mockResolvedValue({
      id: 1,
      factoryKey: "si",
      supplyItemId: 3,
      type: "internal_use",
      quantity: -3,
      referenceId: request.id,
      referenceType: "request",
      note: request.note,
      createdBy: 7,
      createdAt: new Date("2026-04-30T10:00:00.000Z"),
    });

    const result = await fulfillRequest(db as never, request.id, { id: 7 });

    expect(result.status).toBe("fulfilled");
    expect(result.fulfilledAt).toBeInstanceOf(Date);
    expect(checkStockSufficiency).toHaveBeenCalledWith(db.tx, "si", [
      { supplyItemId: 3, quantity: 3 },
      { supplyItemId: 4, quantity: 2 },
    ]);
    expect(writeStockLedger).toHaveBeenCalledTimes(2);
  });
});
