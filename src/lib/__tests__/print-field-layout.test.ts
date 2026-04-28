import { beforeEach, describe, expect, it } from "vitest";
import {
  readFactoryPrintFieldLayout,
  resetFactoryPrintFieldLayout,
  resetFactoryPrintFieldOverride,
  resolvePrintFieldSpec,
  writeFactoryPrintFieldLayout,
  type PrintFieldSpec,
} from "@/lib/print-field-layout";

const SCOPE = "preprinted-bill-test";
const FACTORY = "si";

describe("print-field-layout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty layout when nothing has been saved", () => {
    expect(readFactoryPrintFieldLayout(SCOPE, FACTORY)).toEqual({});
  });

  it("writes and reads per-field overrides", () => {
    writeFactoryPrintFieldLayout(SCOPE, FACTORY, {
      customer: { dxMm: -20, dyMm: 1.5, widthMm: 46 },
      date: { dyMm: 2 },
    });

    expect(readFactoryPrintFieldLayout(SCOPE, FACTORY)).toEqual({
      customer: { dxMm: -20, dyMm: 1.5, widthMm: 46 },
      date: { dyMm: 2 },
    });
  });

  it("resets one field without touching the others", () => {
    writeFactoryPrintFieldLayout(SCOPE, FACTORY, {
      customer: { dxMm: -20, dyMm: 1.5, widthMm: 46 },
      date: { dyMm: 2 },
    });

    resetFactoryPrintFieldOverride(SCOPE, FACTORY, "customer");

    expect(readFactoryPrintFieldLayout(SCOPE, FACTORY)).toEqual({
      date: { dyMm: 2 },
    });
  });

  it("resets all field overrides", () => {
    writeFactoryPrintFieldLayout(SCOPE, FACTORY, {
      customer: { dxMm: -20, dyMm: 1.5, widthMm: 46 },
    });

    resetFactoryPrintFieldLayout(SCOPE, FACTORY);

    expect(readFactoryPrintFieldLayout(SCOPE, FACTORY)).toEqual({});
  });

  it("resolves base positions with stored deltas", () => {
    const spec: PrintFieldSpec<{ y: number }> = {
      id: "customer",
      label: "Customer",
      widthEditable: true,
      getDefaultRect: (context) => ({
        xMm: 12,
        yMm: context.y,
        widthMm: 44,
      }),
    };

    expect(
      resolvePrintFieldSpec(spec, { y: 25 }, { dxMm: -20, dyMm: 3, widthMm: 40 })
    ).toEqual({
      xMm: -8,
      yMm: 28,
      widthMm: 40,
    });
  });
});
