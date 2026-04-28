import { describe, expect, it } from "vitest";

import { buildLegacyRenamePlan } from "@/lib/migrate/legacy-rename";
import { LEGACY_BY_ACCESS_EN } from "@/lib/product-definitions";

describe("legacy rename plan", () => {
  it("builds rename proposals for all six legacy products", () => {
    const plan = buildLegacyRenamePlan([
      { id: 91, name: "แพ็ค", name_en: "Pack", has_bag: false, decreases_bag: false, is_active: true, sort_order: 91 },
      { id: 92, name: "หลอดใหญ่", name_en: "Large Tube", has_bag: true, decreases_bag: false, is_active: true, sort_order: 92 },
      { id: 93, name: "เกล็ด", name_en: "Bare", has_bag: true, decreases_bag: false, is_active: true, sort_order: 93 },
      { id: 94, name: "หลอด 30", name_en: "Unit30", has_bag: true, decreases_bag: false, is_active: true, sort_order: 94 },
      { id: 95, name: "บด", name_en: "Crack", has_bag: true, decreases_bag: false, is_active: true, sort_order: 95 },
      { id: 96, name: "หลอดเล็ก", name_en: "UnitSmall", has_bag: true, decreases_bag: false, is_active: true, sort_order: 96 },
    ]);

    expect(plan.missingIds).toEqual([]);
    expect(plan.changesNeeded).toBe(true);
    expect(plan.proposals.map((proposal) => ({
      id: proposal.id,
      currentName: proposal.currentName,
      proposedName: proposal.proposedName,
      needsChange: proposal.needsChange,
    }))).toEqual([
      { id: 91, currentName: "แพ็ค", proposedName: "ซอง", needsChange: true },
      { id: 92, currentName: "หลอดใหญ่", proposedName: "แพ็ค", needsChange: true },
      { id: 93, currentName: "เกล็ด", proposedName: "หลอดใหญ่", needsChange: true },
      { id: 94, currentName: "หลอด 30", proposedName: "หลอดดล็ก โม่", needsChange: true },
      { id: 95, currentName: "บด", proposedName: "หลอดใหญ่ โม่", needsChange: true },
      { id: 96, currentName: "หลอดเล็ก", proposedName: "หลอดเล็ก", needsChange: false },
    ]);
  });

  it("surfaces missing legacy rows before apply", () => {
    const plan = buildLegacyRenamePlan([
      { id: 91, name: "แพ็ค", name_en: "Pack", has_bag: false, decreases_bag: false, is_active: true, sort_order: 91 },
      { id: 96, name: "หลอดเล็ก", name_en: "UnitSmall", has_bag: true, decreases_bag: false, is_active: true, sort_order: 96 },
    ]);

    expect(plan.missingIds).toEqual([92, 93, 94, 95]);
  });

  it("keeps the shared Access column mapping aligned with renamed legacy labels", () => {
    expect(LEGACY_BY_ACCESS_EN.get("Pack")?.newId).toBe(91);
    expect(LEGACY_BY_ACCESS_EN.get("Unit")?.name).toBe("แพ็ค");
    expect(LEGACY_BY_ACCESS_EN.get("Bare")?.name).toBe("หลอดใหญ่");
    expect(LEGACY_BY_ACCESS_EN.get("Unit30")?.name).toBe("หลอดดล็ก โม่");
    expect(LEGACY_BY_ACCESS_EN.get("Crack")?.name).toBe("หลอดใหญ่ โม่");
    expect(LEGACY_BY_ACCESS_EN.get("UnitSmall")?.name).toBe("หลอดเล็ก");
  });
});
