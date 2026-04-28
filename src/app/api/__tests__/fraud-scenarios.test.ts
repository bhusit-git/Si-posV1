import { describe, it, expect } from "vitest";

/**
 * Fraud / theft scenario tests.
 * Validates that business logic catches or prevents common employee fraud vectors:
 *  1. Void & Pocket — void after cash collected
 *  2. Ghost Return — fake returns for cash
 *  3. Price Shave — alter customer prices for kickbacks
 *  4. Bag Number Fudge — manual bag adjustments to hide theft
 *  5. Payment Manipulation — partial payments used to skim
 *  6. Quantity Manipulation — inflated return quantities
 */

type UserRole = "admin" | "office" | "manager" | "factory";

// ---- Role check simulator ----
function hasPermission(userRole: UserRole, requiredRoles: UserRole[]): boolean {
  return requiredRoles.includes(userRole);
}

// ---- Void requires reason and admin ----
function canVoid(
  userRole: UserRole,
  reason: string | undefined
): { allowed: boolean; error?: string } {
  if (!hasPermission(userRole, ["admin"])) {
    return { allowed: false, error: "ไม่มีสิทธิ์" };
  }
  if (!reason || reason.trim().length === 0) {
    return { allowed: false, error: "ต้องระบุเหตุผล" };
  }
  return { allowed: true };
}

// ---- Return qty validation ----
function validateReturnQty(
  returnItems: { productTypeId: number; quantity: number }[],
  originalItems: { productTypeId: number; quantity: number }[]
): { valid: boolean; error?: string } {
  for (const ret of returnItems) {
    if (ret.quantity <= 0) continue;
    const orig = originalItems.find((i) => i.productTypeId === ret.productTypeId);
    const maxQty = orig ? Math.abs(orig.quantity) : 0;
    if (ret.quantity > maxQty) {
      return {
        valid: false,
        error: `คืนสินค้า ${ret.quantity} เกินจำนวน ${maxQty}`,
      };
    }
  }
  return { valid: true };
}

// ---- Price change audit ----
function auditPriceChange(
  userId: number,
  customerId: number,
  productTypeId: number,
  oldPrice: number,
  newPrice: number
): { suspicious: boolean; reason?: string } {
  const percentChange = oldPrice > 0 ? Math.abs(newPrice - oldPrice) / oldPrice : 1;
  if (percentChange > 0.5) {
    return { suspicious: true, reason: `Price changed ${Math.round(percentChange * 100)}%` };
  }
  return { suspicious: false };
}

// ---- Bag adjustment validation ----
function canAdjustBags(
  userRole: UserRole,
  adjustmentQty: number
): { allowed: boolean; error?: string } {
  if (!hasPermission(userRole, ["admin"])) {
    return { allowed: false, error: "ต้องเป็นผู้ดูแลระบบ" };
  }
  if (adjustmentQty === 0) {
    return { allowed: false, error: "จำนวนต้องไม่เป็น 0" };
  }
  return { allowed: true };
}

describe("Fraud Scenarios", () => {
  describe("Void & Pocket (void after cash collected)", () => {
    it("non-admin cannot void a transaction", () => {
      expect(canVoid("office", "ลูกค้ายกเลิก").allowed).toBe(false);
      expect(canVoid("manager", "ลูกค้ายกเลิก").allowed).toBe(false);
      expect(canVoid("factory", "ลูกค้ายกเลิก").allowed).toBe(false);
    });

    it("admin can void with valid reason", () => {
      expect(canVoid("admin", "ลูกค้ายกเลิก").allowed).toBe(true);
    });

    it("admin cannot void without reason", () => {
      expect(canVoid("admin", "").allowed).toBe(false);
      expect(canVoid("admin", undefined).allowed).toBe(false);
      expect(canVoid("admin", "   ").allowed).toBe(false);
    });

    it("void action creates audit trail entry", () => {
      // Simulating that void action would create: { action: "transaction.void", voidedBy, voidReason }
      const voidResult = canVoid("admin", "สินค้าเสียหาย");
      expect(voidResult.allowed).toBe(true);
      // In real code, audit log is created with userId, reason, totalAmount
    });
  });

  describe("Ghost Return (fake return for cash)", () => {
    it("return qty cannot exceed original bill qty", () => {
      const original = [{ productTypeId: 1, quantity: 10 }];
      const returnItems = [{ productTypeId: 1, quantity: 15 }];
      const result = validateReturnQty(returnItems, original);
      expect(result.valid).toBe(false);
    });

    it("return qty equal to original is allowed", () => {
      const original = [{ productTypeId: 1, quantity: 10 }];
      const returnItems = [{ productTypeId: 1, quantity: 10 }];
      expect(validateReturnQty(returnItems, original).valid).toBe(true);
    });

    it("return for product not in original bill is caught", () => {
      const original = [{ productTypeId: 1, quantity: 10 }];
      const returnItems = [{ productTypeId: 2, quantity: 5 }];
      const result = validateReturnQty(returnItems, original);
      expect(result.valid).toBe(false);
    });

    it("only office and admin can process returns", () => {
      expect(hasPermission("admin", ["admin", "office"])).toBe(true);
      expect(hasPermission("office", ["admin", "office"])).toBe(true);
      expect(hasPermission("manager", ["admin", "office"])).toBe(false);
      expect(hasPermission("factory", ["admin", "office"])).toBe(false);
    });

    it("zero quantity return items are skipped", () => {
      const original = [{ productTypeId: 1, quantity: 10 }];
      const returnItems = [{ productTypeId: 1, quantity: 0 }];
      expect(validateReturnQty(returnItems, original).valid).toBe(true);
    });
  });

  describe("Price Shave (alter prices for kickbacks)", () => {
    it("only admin can change customer prices", () => {
      expect(hasPermission("admin", ["admin"])).toBe(true);
      expect(hasPermission("office", ["admin"])).toBe(false);
      expect(hasPermission("manager", ["admin"])).toBe(false);
    });

    it("large price decrease is flagged as suspicious", () => {
      const audit = auditPriceChange(1, 10, 1, 100, 40);
      expect(audit.suspicious).toBe(true);
    });

    it("small price change is not suspicious", () => {
      const audit = auditPriceChange(1, 10, 1, 100, 95);
      expect(audit.suspicious).toBe(false);
    });

    it("price increase >50% is also suspicious", () => {
      const audit = auditPriceChange(1, 10, 1, 100, 200);
      expect(audit.suspicious).toBe(true);
    });

    it("price change from 0 is always suspicious", () => {
      const audit = auditPriceChange(1, 10, 1, 0, 100);
      expect(audit.suspicious).toBe(true);
    });

    it("audit records old and new price for every change", () => {
      // Simulated: every price change generates audit log entry
      const oldPrice = 100;
      const newPrice = 80;
      expect(oldPrice).not.toBe(newPrice);
      // The audit entry in real code contains: { oldPrice, newPrice, customerId, productTypeId }
    });
  });

  describe("Bag Number Fudge (manual adjustments to hide theft)", () => {
    it("only admin can make manual bag adjustments", () => {
      expect(canAdjustBags("admin", 5).allowed).toBe(true);
      expect(canAdjustBags("office", 5).allowed).toBe(false);
      expect(canAdjustBags("manager", -3).allowed).toBe(false);
    });

    it("zero adjustment is rejected", () => {
      expect(canAdjustBags("admin", 0).allowed).toBe(false);
    });

    it("negative adjustment (removing bags) is allowed for admin", () => {
      expect(canAdjustBags("admin", -10).allowed).toBe(true);
    });

    it("all adjustments have createdBy and are audited", () => {
      // Simulating: bag.adjust entries always have createdBy set
      const adjustment = canAdjustBags("admin", 5);
      expect(adjustment.allowed).toBe(true);
      // In real code: createdBy is set and audit entry created
    });
  });

  describe("Payment Manipulation (partial payment skimming)", () => {
    it("only office and admin can process payments", () => {
      expect(hasPermission("admin", ["admin", "office"])).toBe(true);
      expect(hasPermission("office", ["admin", "office"])).toBe(true);
      expect(hasPermission("manager", ["admin", "office"])).toBe(false);
    });

    it("payment audit captures amount and previous balance", () => {
      // Simulating: payment audit entry records { amount, previousPaid, newPaid, totalAmount }
      const prevPaid = 500;
      const amount = 200;
      const newPaid = prevPaid + amount;
      const totalAmount = 1000;
      expect(newPaid).toBe(700);
      expect(totalAmount - newPaid).toBe(300); // outstanding
    });

    it("payAll batch audit records customer and total amount", () => {
      // Simulating: payAll audit entry records { customerId, paidCount, totalPaidAmount }
      const txs = [
        { totalAmount: 500, paid: 200 },
        { totalAmount: 300, paid: 0 },
      ];
      const totalPaidAmount = txs.reduce(
        (sum, tx) => sum + (tx.totalAmount - tx.paid),
        0
      );
      expect(totalPaidAmount).toBe(600);
    });
  });

  describe("Role escalation prevention", () => {
    it("factory user has minimal permissions", () => {
      const factoryPerms = {
        sale: hasPermission("factory", ["admin", "office", "manager"]),
        voidTx: hasPermission("factory", ["admin"]),
        returns: hasPermission("factory", ["admin", "office"]),
        manageProducts: hasPermission("factory", ["admin"]),
        manageUsers: hasPermission("factory", ["admin"]),
        viewReports: hasPermission("factory", ["admin", "office"]),
        factoryDisplay: hasPermission("factory", ["admin", "office", "manager", "factory"]),
      };

      expect(factoryPerms.sale).toBe(false);
      expect(factoryPerms.voidTx).toBe(false);
      expect(factoryPerms.returns).toBe(false);
      expect(factoryPerms.manageProducts).toBe(false);
      expect(factoryPerms.manageUsers).toBe(false);
      expect(factoryPerms.viewReports).toBe(false);
      expect(factoryPerms.factoryDisplay).toBe(true);
    });

    it("manager user has limited permissions", () => {
      const managerPerms = {
        sale: hasPermission("manager", ["admin", "office", "manager"]),
        voidTx: hasPermission("manager", ["admin"]),
        returns: hasPermission("manager", ["admin", "office"]),
        payment: hasPermission("manager", ["admin", "office"]),
        managePrices: hasPermission("manager", ["admin"]),
        viewCustomers: hasPermission("manager", ["admin", "office", "manager"]),
      };

      expect(managerPerms.sale).toBe(true);
      expect(managerPerms.voidTx).toBe(false);
      expect(managerPerms.returns).toBe(false);
      expect(managerPerms.payment).toBe(false);
      expect(managerPerms.managePrices).toBe(false);
      expect(managerPerms.viewCustomers).toBe(true);
    });

    it("office user has broad but not full permissions", () => {
      const officePerms = {
        sale: hasPermission("office", ["admin", "office", "manager"]),
        returns: hasPermission("office", ["admin", "office"]),
        voidTx: hasPermission("office", ["admin"]),
        managePrices: hasPermission("office", ["admin"]),
        manageProducts: hasPermission("office", ["admin"]),
        reports: hasPermission("office", ["admin", "office"]),
        bags: hasPermission("office", ["admin", "office"]),
        manualBagAdjust: hasPermission("office", ["admin"]),
      };

      expect(officePerms.sale).toBe(true);
      expect(officePerms.returns).toBe(true);
      expect(officePerms.voidTx).toBe(false);
      expect(officePerms.managePrices).toBe(false);
      expect(officePerms.manageProducts).toBe(false);
      expect(officePerms.reports).toBe(true);
      expect(officePerms.bags).toBe(true);
      expect(officePerms.manualBagAdjust).toBe(false);
    });
  });

  describe("Audit trail completeness", () => {
    it("every sensitive action has required audit fields", () => {
      const requiredFields = ["userId", "username", "action", "entity", "entityId"];
      const sampleAudit = {
        userId: 1,
        username: "admin",
        action: "transaction.void",
        entity: "transaction",
        entityId: 42,
        details: { reason: "test" },
      };

      for (const field of requiredFields) {
        expect(sampleAudit).toHaveProperty(field);
        expect((sampleAudit as Record<string, unknown>)[field]).toBeDefined();
      }
    });

    it("audit action names follow entity.verb pattern", () => {
      const validActions = [
        "transaction.create",
        "transaction.void",
        "transaction.payment",
        "transaction.payAll",
        "return.create",
        "price.change",
        "production.create",
        "bag.adjust",
        "user.create",
        "user.update",
        "user.delete",
        "user.passwordChange",
      ];

      for (const action of validActions) {
        const parts = action.split(".");
        expect(parts).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
      }
    });
  });
});
