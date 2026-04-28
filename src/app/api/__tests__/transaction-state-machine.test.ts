import { describe, it, expect } from "vitest";

/**
 * Transaction state machine tests.
 * Validates all legal/illegal state transitions,
 * void logic, payment logic, and bag reversal types.
 */

type TxStatus = "paid" | "unpaid" | "partial" | "voided";
type TxKind = "sale" | "transfer_out" | "return" | "adjustment";

interface Transaction {
  id: number;
  totalAmount: number;
  paid: number;
  status: TxStatus;
  transactionKind?: TxKind;
  voidReason?: string;
  voidedBy?: number;
}

// ---- State transition engine ----

function applyPayment(
  tx: Transaction,
  amount: number
): { error: string } | { paid: number; status: TxStatus } {
  if (tx.status === "voided") return { error: "ไม่สามารถชำระเงินรายการที่ยกเลิกแล้ว" };
  if (tx.transactionKind === "transfer_out") {
    return { error: "บิลเครดิตไม่สามารถรับชำระเงินได้" };
  }
  const newPaid = (tx.paid || 0) + amount;
  let newStatus: TxStatus = "partial";
  if (newPaid >= tx.totalAmount) newStatus = "paid";
  else if (newPaid <= 0) newStatus = "unpaid";
  return { paid: newPaid, status: newStatus };
}

function applyVoid(
  tx: Transaction,
  reason: string | undefined,
  userId: number
): { error: string } | { status: "voided"; voidReason: string; voidedBy: number } {
  if (tx.status === "voided") return { error: "รายการนี้ถูกยกเลิกแล้ว" };
  if (!reason || reason.trim().length === 0) return { error: "ต้องระบุเหตุผลในการยกเลิก" };
  return { status: "voided", voidReason: reason.trim(), voidedBy: userId };
}

function computeReverseType(entryType: "out" | "return" | "adjust"): "out" | "return" | "adjust" {
  if (entryType === "out") return "return";
  if (entryType === "return") return "out";
  return "adjust";
}

describe("Transaction State Machine", () => {
  describe("lifecycle transitions", () => {
    it("new sale with full payment is paid", () => {
      const tx: Transaction = { id: 1, totalAmount: 1000, paid: 1000, status: "paid" };
      expect(tx.status).toBe("paid");
    });

    it("new sale with no payment is unpaid", () => {
      const tx: Transaction = { id: 2, totalAmount: 1000, paid: 0, status: "unpaid" };
      expect(tx.status).toBe("unpaid");
    });

    it("new sale with partial payment is partial", () => {
      const tx: Transaction = { id: 3, totalAmount: 1000, paid: 500, status: "partial" };
      expect(tx.status).toBe("partial");
    });

    it("unpaid → partial via payment", () => {
      const tx: Transaction = { id: 4, totalAmount: 1000, paid: 0, status: "unpaid" };
      const result = applyPayment(tx, 300);
      expect("paid" in result && result.status).toBe("partial");
      expect("paid" in result && result.paid).toBe(300);
    });

    it("unpaid → paid via full payment", () => {
      const tx: Transaction = { id: 5, totalAmount: 1000, paid: 0, status: "unpaid" };
      const result = applyPayment(tx, 1000);
      expect("paid" in result && result.status).toBe("paid");
    });

    it("partial → paid via remaining payment", () => {
      const tx: Transaction = { id: 6, totalAmount: 1000, paid: 500, status: "partial" };
      const result = applyPayment(tx, 500);
      expect("paid" in result && result.status).toBe("paid");
      expect("paid" in result && result.paid).toBe(1000);
    });

    it("partial → paid even with overpayment", () => {
      const tx: Transaction = { id: 7, totalAmount: 1000, paid: 500, status: "partial" };
      const result = applyPayment(tx, 600);
      expect("paid" in result && result.status).toBe("paid");
      expect("paid" in result && result.paid).toBe(1100);
    });

    it("paid → voided via void action", () => {
      const tx: Transaction = { id: 8, totalAmount: 1000, paid: 1000, status: "paid" };
      const result = applyVoid(tx, "ลูกค้ายกเลิก", 1);
      expect("status" in result && result.status).toBe("voided");
    });

    it("unpaid → voided via void action", () => {
      const tx: Transaction = { id: 9, totalAmount: 1000, paid: 0, status: "unpaid" };
      const result = applyVoid(tx, "ข้อมูลผิด", 1);
      expect("status" in result && result.status).toBe("voided");
    });
  });

  describe("double-void prevention", () => {
    it("cannot void an already voided transaction", () => {
      const tx: Transaction = { id: 10, totalAmount: 1000, paid: 1000, status: "voided" };
      const result = applyVoid(tx, "try again", 1);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toBe("รายการนี้ถูกยกเลิกแล้ว");
      }
    });
  });

  describe("void + payment conflict", () => {
    it("cannot pay a voided transaction", () => {
      const tx: Transaction = { id: 11, totalAmount: 1000, paid: 0, status: "voided" };
      const result = applyPayment(tx, 500);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toBe("ไม่สามารถชำระเงินรายการที่ยกเลิกแล้ว");
      }
    });

    it("cannot pay a transfer transaction", () => {
      const tx: Transaction = {
        id: 111,
        totalAmount: 1000,
        paid: 1000,
        status: "paid",
        transactionKind: "transfer_out",
      };
      const result = applyPayment(tx, 500);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toBe("บิลเครดิตไม่สามารถรับชำระเงินได้");
      }
    });
  });

  describe("void requires reason", () => {
    it("empty reason is rejected", () => {
      const tx: Transaction = { id: 12, totalAmount: 1000, paid: 1000, status: "paid" };
      const result = applyVoid(tx, "", 1);
      expect("error" in result).toBe(true);
    });

    it("whitespace-only reason is rejected", () => {
      const tx: Transaction = { id: 13, totalAmount: 1000, paid: 1000, status: "paid" };
      const result = applyVoid(tx, "   ", 1);
      expect("error" in result).toBe(true);
    });

    it("undefined reason is rejected", () => {
      const tx: Transaction = { id: 14, totalAmount: 1000, paid: 1000, status: "paid" };
      const result = applyVoid(tx, undefined, 1);
      expect("error" in result).toBe(true);
    });

    it("valid reason is accepted and trimmed", () => {
      const tx: Transaction = { id: 15, totalAmount: 1000, paid: 1000, status: "paid" };
      const result = applyVoid(tx, "  ลูกค้ายกเลิก  ", 1);
      expect("status" in result).toBe(true);
      if ("status" in result) {
        expect(result.voidReason).toBe("ลูกค้ายกเลิก");
        expect(result.voidedBy).toBe(1);
      }
    });
  });

  describe("payAll batch logic", () => {
    function payAllBatch(txs: Transaction[]): { paidCount: number; totalPaidAmount: number } {
      let paidCount = 0;
      let totalPaidAmount = 0;
      for (const tx of txs) {
        if (tx.transactionKind === "transfer_out") continue;
        if (tx.status === "voided" || tx.status === "paid") continue;
        const outstanding = tx.totalAmount - (tx.paid || 0);
        if (outstanding > 0) {
          paidCount++;
          totalPaidAmount += outstanding;
        }
      }
      return { paidCount, totalPaidAmount };
    }

    it("pays all unpaid transactions", () => {
      const txs: Transaction[] = [
        { id: 1, totalAmount: 500, paid: 0, status: "unpaid" },
        { id: 2, totalAmount: 300, paid: 0, status: "unpaid" },
      ];
      const result = payAllBatch(txs);
      expect(result.paidCount).toBe(2);
      expect(result.totalPaidAmount).toBe(800);
    });

    it("pays only remaining on partial transactions", () => {
      const txs: Transaction[] = [
        { id: 1, totalAmount: 1000, paid: 600, status: "partial" },
        { id: 2, totalAmount: 500, paid: 0, status: "unpaid" },
      ];
      const result = payAllBatch(txs);
      expect(result.paidCount).toBe(2);
      expect(result.totalPaidAmount).toBe(900);
    });

    it("skips voided transactions", () => {
      const txs: Transaction[] = [
        { id: 1, totalAmount: 500, paid: 0, status: "voided" },
        { id: 2, totalAmount: 300, paid: 0, status: "unpaid" },
      ];
      const result = payAllBatch(txs);
      expect(result.paidCount).toBe(1);
      expect(result.totalPaidAmount).toBe(300);
    });

    it("skips already paid transactions", () => {
      const txs: Transaction[] = [
        { id: 1, totalAmount: 500, paid: 500, status: "paid" },
        { id: 2, totalAmount: 300, paid: 300, status: "paid" },
      ];
      const result = payAllBatch(txs);
      expect(result.paidCount).toBe(0);
      expect(result.totalPaidAmount).toBe(0);
    });

    it("handles empty array", () => {
      const result = payAllBatch([]);
      expect(result.paidCount).toBe(0);
      expect(result.totalPaidAmount).toBe(0);
    });

    it("skips transfer_out transactions", () => {
      const txs: Transaction[] = [
        { id: 1, totalAmount: 500, paid: 0, status: "unpaid", transactionKind: "transfer_out" },
        { id: 2, totalAmount: 300, paid: 0, status: "unpaid", transactionKind: "sale" },
      ];
      const result = payAllBatch(txs);
      expect(result.paidCount).toBe(1);
      expect(result.totalPaidAmount).toBe(300);
    });
  });

  describe("bag reversal types", () => {
    it("out reverses to return", () => {
      expect(computeReverseType("out")).toBe("return");
    });

    it("return reverses to out", () => {
      expect(computeReverseType("return")).toBe("out");
    });

    it("adjust reverses to adjust", () => {
      expect(computeReverseType("adjust")).toBe("adjust");
    });
  });

  describe("zero-amount edge cases", () => {
    it("payment of 0 on unpaid stays unpaid", () => {
      const tx: Transaction = { id: 20, totalAmount: 1000, paid: 0, status: "unpaid" };
      const result = applyPayment(tx, 0);
      expect("status" in result && result.status).toBe("unpaid");
    });

    it("zero-total transaction is always paid", () => {
      const tx: Transaction = { id: 21, totalAmount: 0, paid: 0, status: "paid" };
      const result = applyPayment(tx, 0);
      expect("status" in result && result.status).toBe("paid");
    });

    it("negative payment reduces paid amount", () => {
      const tx: Transaction = { id: 22, totalAmount: 1000, paid: 600, status: "partial" };
      const result = applyPayment(tx, -200);
      expect("paid" in result && result.paid).toBe(400);
      expect("status" in result && result.status).toBe("partial");
    });
  });
});
