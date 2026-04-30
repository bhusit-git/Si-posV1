import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supply/stock-engine", () => ({
  checkStockSufficiency: vi.fn(),
  writeStockLedger: vi.fn(),
}));

import { supplyTransferItems, supplyTransfers } from "@/db/schema";
import {
  createTransfer,
  receiveTransfer,
} from "@/lib/supply/transfer-engine";
import {
  checkStockSufficiency,
  writeStockLedger,
} from "@/lib/supply/stock-engine";

function buildTransfer(overrides: Partial<typeof supplyTransfers.$inferSelect> = {}) {
  return {
    id: 91,
    transferRef: "XFER-20260430-001",
    fromFactoryKey: "si",
    toFactoryKey: "bearing",
    status: "sending" as const,
    note: "ของใช้รอบเช้า",
    createdBy: 8,
    sentAt: null,
    receivedBy: null,
    receivedAt: null,
    createdAt: new Date("2026-04-30T01:00:00.000Z"),
    updatedAt: new Date("2026-04-30T01:00:00.000Z"),
    ...overrides,
  };
}

function buildTransferItem(
  overrides: Partial<typeof supplyTransferItems.$inferSelect> = {}
) {
  return {
    id: 501,
    transferId: 91,
    supplyItemId: 4,
    quantityShipped: 3,
    quantityReceived: null,
    note: null,
    ...overrides,
  };
}

function createTransferRefSelectDb(existingRefs: string[] = []) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(
          existingRefs.map((transferRef) => ({
            transferRef,
          }))
        ),
      })),
    })),
  };
}

describe("transfer-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createTransfer writes sending -> pending_receive -> sent and cuts source stock", async () => {
    const fromSending = buildTransfer();
    const fromSent = buildTransfer({ status: "sent", sentAt: new Date("2026-04-30T02:00:00.000Z") });
    const toPending = buildTransfer({
      id: 12,
      status: "pending_receive",
      sentAt: new Date("2026-04-30T02:00:00.000Z"),
    });
    const fromDb = {
      ...createTransferRefSelectDb(),
      transaction: vi
        .fn()
        .mockImplementationOnce(async (callback) =>
          callback({
            insert: vi.fn((table) => {
              if (table === supplyTransfers) {
                return {
                  values: vi.fn(() => ({
                    returning: vi.fn().mockResolvedValue([fromSending]),
                  })),
                };
              }

              if (table === supplyTransferItems) {
                return {
                  values: vi.fn().mockResolvedValue(undefined),
                };
              }

              throw new Error("Unexpected insert table");
            }),
          })
        )
        .mockImplementationOnce(async (callback) =>
          callback({
            update: vi.fn(() => ({
              set: vi.fn(() => ({
                where: vi.fn(() => ({
                  returning: vi.fn().mockResolvedValue([fromSent]),
                })),
              })),
            })),
          })
        ),
    };
    const toDb = {
      transaction: vi.fn(async (callback) =>
        callback({
          insert: vi.fn((table) => {
            if (table === supplyTransfers) {
              return {
                values: vi.fn(() => ({
                  returning: vi.fn().mockResolvedValue([toPending]),
                })),
              };
            }

            if (table === supplyTransferItems) {
              return {
                values: vi.fn().mockResolvedValue(undefined),
              };
            }

            throw new Error("Unexpected insert table");
          }),
        })
      ),
    };

    vi.mocked(checkStockSufficiency).mockResolvedValue({
      sufficient: true,
      shortfalls: [],
    });
    vi.mocked(writeStockLedger).mockResolvedValue({
      id: 1,
      factoryKey: "si",
      supplyItemId: 4,
      type: "transfer_out",
      quantity: -3,
      referenceId: fromSending.id,
      referenceType: "transfer",
      note: "ของใช้รอบเช้า",
      createdBy: 8,
      createdAt: new Date("2026-04-30T02:00:00.000Z"),
    });

    const result = await createTransfer(
      fromDb as never,
      toDb as never,
      {
        fromFactoryKey: "si",
        toFactoryKey: "bearing",
        note: "ของใช้รอบเช้า",
        items: [{ supplyItemId: 4, quantity: 3 }],
      },
      { id: 8 }
    );

    expect(result).toEqual({
      fromRecord: fromSent,
      toRecord: toPending,
    });
    expect(checkStockSufficiency).toHaveBeenCalledWith(fromDb, "si", [
      { supplyItemId: 4, quantity: 3 },
    ]);
    expect(writeStockLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        factoryKey: "si",
        supplyItemId: 4,
        type: "transfer_out",
        quantity: -3,
        referenceId: fromSending.id,
      })
    );
  });

  it("createTransfer rolls back source status to cancelled when destination write fails", async () => {
    const fromSending = buildTransfer();
    const fromDb = {
      ...createTransferRefSelectDb(),
      transaction: vi
        .fn()
        .mockImplementationOnce(async (callback) =>
          callback({
            insert: vi.fn((table) => {
              if (table === supplyTransfers) {
                return {
                  values: vi.fn(() => ({
                    returning: vi.fn().mockResolvedValue([fromSending]),
                  })),
                };
              }

              if (table === supplyTransferItems) {
                return {
                  values: vi.fn().mockResolvedValue(undefined),
                };
              }

              throw new Error("Unexpected insert table");
            }),
          })
        )
        .mockImplementationOnce(async (callback) =>
          callback({
            update: vi.fn(() => ({
              set: vi.fn(() => ({
                where: vi.fn().mockResolvedValue(undefined),
              })),
            })),
          })
        ),
    };
    const toDb = {
      transaction: vi.fn().mockRejectedValue(new Error("destination down")),
    };

    vi.mocked(checkStockSufficiency).mockResolvedValue({
      sufficient: true,
      shortfalls: [],
    });

    await expect(
      createTransfer(
        fromDb as never,
        toDb as never,
        {
          fromFactoryKey: "si",
          toFactoryKey: "bearing",
          note: "ของใช้รอบเช้า",
          items: [{ supplyItemId: 4, quantity: 3 }],
        },
        { id: 8 }
      )
    ).rejects.toThrow("destination down");

    expect(fromDb.transaction).toHaveBeenCalledTimes(2);
    expect(writeStockLedger).not.toHaveBeenCalled();
  });

  it("receiveTransfer marks destination as received, writes transfer_in, and confirms the source", async () => {
    const toTransfer = buildTransfer({
      id: 12,
      status: "pending_receive",
      sentAt: new Date("2026-04-30T02:00:00.000Z"),
    });
    const fromTransfer = buildTransfer({
      status: "sent",
      sentAt: new Date("2026-04-30T02:00:00.000Z"),
    });
    const updatedToTransfer = buildTransfer({
      id: 12,
      status: "received",
      sentAt: new Date("2026-04-30T02:00:00.000Z"),
      receivedBy: 9,
      receivedAt: new Date("2026-04-30T03:00:00.000Z"),
    });
    const transferItems = [buildTransferItem({ id: 501, transferId: 12, quantityShipped: 3 })];

    const fromDb = {
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table !== supplyTransfers) throw new Error("Unexpected fromDb select table");
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([fromTransfer]),
            })),
          };
        }),
      })),
      transaction: vi.fn(async (callback) =>
        callback({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn().mockResolvedValue(undefined),
            })),
          })),
        })
      ),
    };
    const toDb = {
      select: vi.fn(() => ({
        from: vi.fn((table) => {
          if (table === supplyTransfers) {
            return {
              where: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([toTransfer]),
              })),
            };
          }

          if (table === supplyTransferItems) {
            return {
              where: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue(transferItems),
              })),
            };
          }

          throw new Error("Unexpected toDb select table");
        }),
      })),
      transaction: vi.fn(async (callback) =>
        callback({
          update: vi.fn((table) => {
            if (table === supplyTransferItems) {
              return {
                set: vi.fn(() => ({
                  where: vi.fn().mockResolvedValue(undefined),
                })),
              };
            }

            if (table === supplyTransfers) {
              return {
                set: vi.fn(() => ({
                  where: vi.fn(() => ({
                    returning: vi.fn().mockResolvedValue([updatedToTransfer]),
                  })),
                })),
              };
            }

            throw new Error("Unexpected update table");
          }),
        })
      ),
    };

    vi.mocked(writeStockLedger).mockResolvedValue({
      id: 1,
      factoryKey: "bearing",
      supplyItemId: 4,
      type: "transfer_in",
      quantity: 2,
      referenceId: updatedToTransfer.id,
      referenceType: "transfer",
      note: updatedToTransfer.note,
      createdBy: 9,
      createdAt: new Date("2026-04-30T03:00:00.000Z"),
    });

    await receiveTransfer(fromDb as never, toDb as never, 12, { id: 9 }, [
      { transferItemId: 501, quantity: 2 },
    ]);

    expect(writeStockLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        factoryKey: "bearing",
        supplyItemId: 4,
        type: "transfer_in",
        quantity: 2,
        referenceId: updatedToTransfer.id,
      })
    );
    expect(fromDb.transaction).toHaveBeenCalledTimes(1);
    expect(toDb.transaction).toHaveBeenCalledTimes(1);
  });
});
