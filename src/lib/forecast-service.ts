import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { DrizzleDB } from "@/db";
import { forecastOutputs } from "@/db/schema";
import { getDateInTimezone, shiftDate, REPORT_TIMEZONE } from "@/lib/line-report-utils";
import { getSupericeForecastEnv } from "@/lib/config/env";

const forecastRowSchema = z.object({
  product_type_id: z.number().int().nullable(),
  product_name: z.string().optional(),
  predicted_units: z.number(),
  predicted_units_lower: z.number(),
  predicted_units_upper: z.number(),
  predicted_revenue: z.number(),
  predicted_revenue_lower: z.number(),
  predicted_revenue_upper: z.number(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  key_drivers: z.array(z.unknown()).optional().default([]),
});

const artifactSchema = z.object({
  factory_key: z.string().min(1),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generated_at: z.string().optional().default(""),
  model_version: z.string().min(1),
  model_family: z.string().optional().default(""),
  feature_snapshot_hash: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  regime_distance: z.number().optional().default(0),
  key_drivers: z.array(z.unknown()).optional().default([]),
  data_end_date: z.string().optional().default(""),
  signal_coverage: z.record(z.string(), z.unknown()).optional().default({}),
  rows: z.array(forecastRowSchema).min(1),
});

const runManifestSchema = z.object({
  approved: z.boolean().optional().default(false),
  model_version: z.string().optional(),
});

export type ForecastArtifact = z.infer<typeof artifactSchema>;

export interface ForecastSnapshot {
  targetDate: string;
  modelVersion: string;
  modelFamily: string;
  dataEndDate: string;
  featureSnapshotHash: string;
  confidence: "high" | "medium" | "low";
  regimeDistance: number;
  keyDrivers: unknown[];
  signalCoverage: Record<string, unknown>;
  total: {
    predictedUnits: number;
    predictedUnitsLower: number;
    predictedUnitsUpper: number;
    predictedRevenue: number;
    predictedRevenueLower: number;
    predictedRevenueUpper: number;
    confidence: "high" | "medium" | "low";
  } | null;
  products: {
    productTypeId: number | null;
    productName: string;
    predictedUnits: number;
    predictedUnitsLower: number;
    predictedUnitsUpper: number;
    predictedRevenue: number;
    predictedRevenueLower: number;
    predictedRevenueUpper: number;
    confidence: "high" | "medium" | "low";
    keyDrivers: unknown[];
    modelFamily?: string;
  }[];
}

interface ForecastDbRow {
  productTypeId: number | null;
  productName: string | null;
  predictedUnits: number;
  predictedUnitsLower: number;
  predictedUnitsUpper: number;
  predictedRevenue: number;
  predictedRevenueLower: number;
  predictedRevenueUpper: number;
  confidence: string | null;
  keyDrivers: unknown;
  modelVersion: string;
  modelFamily: string | null;
  featureSnapshotHash: string;
  dataEndDate: string | null;
  signalCoverage: unknown;
  sourceGeneratedAt: Date;
  targetDate: string;
  productKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export function tomorrowInBangkok(): string {
  return shiftDate(getDateInTimezone(REPORT_TIMEZONE), 1);
}

function isMissingForecastOutputsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { code?: unknown; cause?: unknown; message?: unknown };
  if (rec.code === "42P01") return true;
  if (typeof rec.message === "string" && rec.message.includes(`"forecast_outputs"`)) {
    return true;
  }
  return isMissingForecastOutputsError(rec.cause);
}

function downgradeConfidence(base: "high" | "medium" | "low"): "high" | "medium" | "low" {
  if (base === "high") return "medium";
  if (base === "medium") return "low";
  return "low";
}

function confidenceWithCoverage(
  base: "high" | "medium" | "low",
  signalCoverage: Record<string, unknown>
): "high" | "medium" | "low" {
  let current = base;
  if (signalCoverage.source_data_stale === true) {
    current = downgradeConfidence(current);
  }

  const weatherSource = String(signalCoverage.weather_forecast_source || "");
  if (weatherSource === "fallback_history" || signalCoverage.weather_forecast_fallback === true) {
    current = downgradeConfidence(current);
  }

  const groups = signalCoverage.groups as Record<string, { avg_non_null_ratio?: number }> | undefined;
  const weakGroups = groups
    ? Object.values(groups).filter((group) => Number(group?.avg_non_null_ratio || 0) < 0.85)
    : [];
  if (weakGroups.length >= 2) {
    current = downgradeConfidence(current);
  }
  return current;
}

function artifactRootCandidates(): string[] {
  const forecastEnv = getSupericeForecastEnv();
  if (forecastEnv.forecastArtifactsDir) {
    return [forecastEnv.forecastArtifactsDir];
  }

  return [
    path.resolve(process.cwd(), "ml-demand-autoresearch", "artifacts", "latest"),
    path.resolve(process.cwd(), "..", "ml-demand-autoresearch", "artifacts", "latest"),
    path.resolve(process.cwd(), "..", "..", "ml-demand-autoresearch", "artifacts", "latest"),
  ];
}

async function resolveArtifactRoot(): Promise<string> {
  const candidates = artifactRootCandidates();
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {
      // continue
    }
  }

  return candidates[0];
}

export async function loadForecastArtifact(factoryKey: string): Promise<ForecastArtifact> {
  const root = await resolveArtifactRoot();
  const directPath = path.join(root, factoryKey, "next_day_forecast.json");
  const defaultPath = path.join(root, "default", "next_day_forecast.json");

  const filePath = await (async () => {
    try {
      await fs.access(directPath);
      return directPath;
    } catch {
      await fs.access(defaultPath);
      return defaultPath;
    }
  })();

  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  const artifact = artifactSchema.parse(parsed);

  const manifestPath = path.join(path.dirname(filePath), "run_manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf-8");
  const manifest = runManifestSchema.parse(JSON.parse(manifestRaw));
  const allowUnapproved = getSupericeForecastEnv().forecastAllowUnapproved;
  if (!manifest.approved && !allowUnapproved) {
    throw new Error("Latest forecast artifact is not approved by quality gate");
  }

  return artifact;
}

export async function persistForecastArtifact(
  db: DrizzleDB,
  factoryKey: string,
  artifact: ForecastArtifact
): Promise<{ upserted: number; targetDate: string; modelVersion: string }> {
  const generatedAt = artifact.generated_at ? new Date(artifact.generated_at) : new Date();

  const normalizedMap = new Map<
    string,
    {
      factoryKey: string;
      targetDate: string;
      productKey: string;
      productTypeId: number | null;
      productName: string;
      predictedUnits: number;
      predictedUnitsLower: number;
      predictedUnitsUpper: number;
      predictedRevenue: number;
      predictedRevenueLower: number;
      predictedRevenueUpper: number;
      confidence: "high" | "medium" | "low";
      keyDrivers: unknown[];
      modelVersion: string;
      modelFamily: string;
      featureSnapshotHash: string;
      dataEndDate: string | null;
      signalCoverage: unknown;
      sourceGeneratedAt: Date;
      updatedAt: Date;
    }
  >();

  for (const row of artifact.rows) {
    const productKey = row.product_type_id == null ? "total" : `product:${row.product_type_id}`;
    const productName = row.product_name || (row.product_type_id == null ? "TOTAL" : `PRODUCT ${row.product_type_id}`);
    normalizedMap.set(productKey, {
      factoryKey,
      targetDate: artifact.target_date,
      productKey,
      productTypeId: row.product_type_id,
      productName,
      predictedUnits: row.predicted_units,
      predictedUnitsLower: row.predicted_units_lower,
      predictedUnitsUpper: row.predicted_units_upper,
      predictedRevenue: row.predicted_revenue,
      predictedRevenueLower: row.predicted_revenue_lower,
      predictedRevenueUpper: row.predicted_revenue_upper,
      confidence: row.confidence,
      keyDrivers: row.key_drivers,
      modelVersion: artifact.model_version,
      modelFamily: artifact.model_family,
      featureSnapshotHash: artifact.feature_snapshot_hash,
      dataEndDate: artifact.data_end_date || null,
      signalCoverage: artifact.signal_coverage,
      sourceGeneratedAt: generatedAt,
      updatedAt: new Date(),
    });
  }

  const values = [...normalizedMap.values()];

  for (const value of values) {
    await db
      .insert(forecastOutputs)
      .values(value)
      .onConflictDoUpdate({
        target: [
          forecastOutputs.factoryKey,
          forecastOutputs.targetDate,
          forecastOutputs.productKey,
        ],
        set: {
          productTypeId: value.productTypeId,
          productName: value.productName,
          predictedUnits: value.predictedUnits,
          predictedUnitsLower: value.predictedUnitsLower,
          predictedUnitsUpper: value.predictedUnitsUpper,
          predictedRevenue: value.predictedRevenue,
          predictedRevenueLower: value.predictedRevenueLower,
          predictedRevenueUpper: value.predictedRevenueUpper,
          confidence: value.confidence,
          keyDrivers: value.keyDrivers,
          modelVersion: value.modelVersion,
          modelFamily: value.modelFamily,
          featureSnapshotHash: value.featureSnapshotHash,
          dataEndDate: value.dataEndDate,
          signalCoverage: value.signalCoverage,
          sourceGeneratedAt: value.sourceGeneratedAt,
          updatedAt: sql`now()`,
        },
      });
  }

  return {
    upserted: values.length,
    targetDate: artifact.target_date,
    modelVersion: artifact.model_version,
  };
}

export async function getForecastSnapshot(
  db: DrizzleDB,
  factoryKey: string,
  targetDate: string
): Promise<ForecastSnapshot | null> {
  let rows: ForecastDbRow[];

  try {
    rows = (await db
      .select({
        productTypeId: forecastOutputs.productTypeId,
        productName: forecastOutputs.productName,
        predictedUnits: forecastOutputs.predictedUnits,
        predictedUnitsLower: forecastOutputs.predictedUnitsLower,
        predictedUnitsUpper: forecastOutputs.predictedUnitsUpper,
        predictedRevenue: forecastOutputs.predictedRevenue,
        predictedRevenueLower: forecastOutputs.predictedRevenueLower,
        predictedRevenueUpper: forecastOutputs.predictedRevenueUpper,
        confidence: forecastOutputs.confidence,
        keyDrivers: forecastOutputs.keyDrivers,
        modelVersion: forecastOutputs.modelVersion,
        modelFamily: forecastOutputs.modelFamily,
        featureSnapshotHash: forecastOutputs.featureSnapshotHash,
        dataEndDate: forecastOutputs.dataEndDate,
        signalCoverage: forecastOutputs.signalCoverage,
        sourceGeneratedAt: forecastOutputs.sourceGeneratedAt,
        targetDate: forecastOutputs.targetDate,
        productKey: forecastOutputs.productKey,
        createdAt: forecastOutputs.createdAt,
        updatedAt: forecastOutputs.updatedAt,
      })
      .from(forecastOutputs)
      .where(and(eq(forecastOutputs.factoryKey, factoryKey), eq(forecastOutputs.targetDate, targetDate)))
      .orderBy(asc(forecastOutputs.productKey))) as ForecastDbRow[];
  } catch (error) {
    if (isMissingForecastOutputsError(error)) {
      return null;
    }
    throw error;
  }

  if (rows.length === 0) return null;

  const totalRow = rows.find((row) => row.productKey === "total") ?? null;

  const modelVersion = rows[0].modelVersion;
  const modelFamily = rows[0].modelFamily || "";
  const dataEndDate = rows[0].dataEndDate || "";
  const featureSnapshotHash = rows[0].featureSnapshotHash;
  const keyDrivers = (totalRow?.keyDrivers as unknown[]) || [];
  const signalCoverage = (rows[0].signalCoverage as Record<string, unknown>) || {};
  const resolvedConfidence = confidenceWithCoverage(
    (totalRow?.confidence || "medium") as "high" | "medium" | "low",
    signalCoverage
  );

  return {
    targetDate,
    modelVersion,
    modelFamily,
    dataEndDate,
    featureSnapshotHash,
    confidence: resolvedConfidence,
    regimeDistance: 0,
    keyDrivers,
    signalCoverage,
    total: totalRow
      ? {
          predictedUnits: Number(totalRow.predictedUnits || 0),
          predictedUnitsLower: Number(totalRow.predictedUnitsLower || 0),
          predictedUnitsUpper: Number(totalRow.predictedUnitsUpper || 0),
          predictedRevenue: Number(totalRow.predictedRevenue || 0),
          predictedRevenueLower: Number(totalRow.predictedRevenueLower || 0),
          predictedRevenueUpper: Number(totalRow.predictedRevenueUpper || 0),
          confidence: resolvedConfidence,
        }
      : null,
    products: rows.map((row) => ({
      productTypeId: row.productTypeId,
      productName: row.productName || "",
      predictedUnits: Number(row.predictedUnits || 0),
      predictedUnitsLower: Number(row.predictedUnitsLower || 0),
      predictedUnitsUpper: Number(row.predictedUnitsUpper || 0),
      predictedRevenue: Number(row.predictedRevenue || 0),
      predictedRevenueLower: Number(row.predictedRevenueLower || 0),
      predictedRevenueUpper: Number(row.predictedRevenueUpper || 0),
      confidence: (row.confidence || "medium") as "high" | "medium" | "low",
      keyDrivers: (row.keyDrivers as unknown[]) || [],
      modelFamily: row.modelFamily || "",
    })),
  };
}
