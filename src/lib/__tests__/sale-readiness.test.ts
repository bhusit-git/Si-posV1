import { describe, expect, it } from "vitest";
import { computeSaleReadinessMetrics } from "@/lib/sale-readiness";

describe("computeSaleReadinessMetrics", () => {
  it("derives auth, navigation, reference-ready, and interactive timings", () => {
    expect(
      computeSaleReadinessMetrics({
        loginSubmitStartedAt: 1_000,
        loginResponseReceivedAt: 1_350,
        saleRouteMountedAt: 1_650,
        referenceReadyAt: 2_050,
        saleInteractiveAt: 2_250,
      })
    ).toEqual({
      authMs: 350,
      navigationMs: 300,
      saleReferenceReadyMs: 400,
      saleBootstrapMs: 600,
      loginToSaleInteractiveMs: 1_250,
    });
  });

  it("returns null durations when prerequisite marks are missing", () => {
    expect(
      computeSaleReadinessMetrics({
        loginSubmitStartedAt: null,
        loginResponseReceivedAt: null,
        saleRouteMountedAt: 1_650,
        referenceReadyAt: null,
        saleInteractiveAt: 2_250,
      })
    ).toEqual({
      authMs: null,
      navigationMs: null,
      saleReferenceReadyMs: null,
      saleBootstrapMs: 600,
      loginToSaleInteractiveMs: null,
    });
  });
});
