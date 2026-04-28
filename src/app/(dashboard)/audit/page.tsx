"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildAuditSummaryCards,
  formatFindingEvidencePreview,
  type AuditFindingSummary,
} from "@/lib/audit-monitoring";
import {
  DEFAULT_FRAUD_FINDING_CATEGORIES,
  DEFAULT_FRAUD_FINDING_RULE_KEYS,
  FINDING_CATEGORY_LABELS,
  FINDING_RULE_LABELS,
  FINDING_STATUS_LABELS,
  getFindingRuleLabel,
} from "@/lib/audit-findings";
import { cn } from "@/lib/utils";

interface AuditEntry {
  id: number;
  userId: number | null;
  username: string;
  action: string;
  entity: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface FindingRow {
  id: number;
  fingerprint: string;
  ruleKey: string;
  category: keyof typeof FINDING_CATEGORY_LABELS;
  severity: "medium" | "high" | "critical";
  riskScore: number;
  status: "open" | "reviewed" | "dismissed";
  entity: string;
  entityId: number | null;
  userId: number | null;
  username: string | null;
  customerId: number | null;
  transactionId: number | null;
  title: string;
  reason: string;
  evidence: Record<string, unknown> | null;
  reviewNote: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  "transaction.create": "สร้างรายการ",
  "transaction.void": "ยกเลิกรายการ",
  "transaction.payment": "บันทึกชำระเงิน",
  "transaction.pay": "ชำระเงิน",
  "transaction.payAll": "ชำระทั้งหมด",
  "transaction.accounting_settle": "ปิดยอดบัญชี",
  "return.create": "คืนสินค้า",
  "customer.create": "สร้างลูกค้า",
  "customer.update": "แก้ไขลูกค้า",
  "product.create": "สร้างสินค้า",
  "product.update": "แก้ไขสินค้า",
  "production.create": "บันทึกผลิต",
  "bag.adjust": "ปรับถุง",
  "bill_counter.update": "แก้เลขบิลถัดไป",
  "price.change": "เปลี่ยนราคา",
  "user.create": "สร้างผู้ใช้",
  "user.update": "แก้ไขผู้ใช้",
  "user.delete": "ลบผู้ใช้",
  "user.passwordChange": "เปลี่ยนรหัสผ่าน",
  "sync.queued": "เพิ่มคิวออฟไลน์",
  "sync.sync_started": "เริ่มซิงค์ออฟไลน์",
  "sync.sale_synced": "ซิงค์รายการสำเร็จ",
  "sync.sale_failed": "ซิงค์รายการไม่สำเร็จ",
  "sync.sync_finished": "จบรอบซิงค์",
};

function getAuditActionLabel(log: AuditEntry) {
  const customLabel =
    log.details && typeof log.details.auditActionLabel === "string"
      ? log.details.auditActionLabel
      : null;
  return customLabel || ACTION_LABELS[log.action] || log.action;
}

const ENTITY_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "transaction", label: "รายการขาย" },
  { value: "return", label: "คืนสินค้า" },
  { value: "customer", label: "ลูกค้า" },
  { value: "product", label: "สินค้า" },
  { value: "production", label: "ผลิต" },
  { value: "bag", label: "ถุง" },
  { value: "bill_counter", label: "เลขบิล" },
  { value: "customer_price", label: "ราคา" },
  { value: "user", label: "ผู้ใช้" },
  { value: "sync", label: "ซิงค์ออฟไลน์" },
];

const FINDING_RULE_OPTIONS = [
  { value: "all", label: "ทุกกฎ" },
  ...DEFAULT_FRAUD_FINDING_RULE_KEYS.map((value) => ({
    value,
    label: FINDING_RULE_LABELS[value],
  })),
];

const FINDING_CATEGORY_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  ...DEFAULT_FRAUD_FINDING_CATEGORIES.map((value) => ({
    value,
    label: FINDING_CATEGORY_LABELS[value],
  })),
];

const EMPTY_FINDING_SUMMARY: AuditFindingSummary = {
  suspiciousCancellations: 0,
  anomalyOrders: 0,
  suspiciousPayments: 0,
  unresolvedCriticalHigh: 0,
  openCount: 0,
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDefaultFindingWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return {
    from: toDateInputValue(start),
    to: toDateInputValue(now),
  };
}

function formatDateTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDetails(details: Record<string, unknown> | null) {
  if (!details) return "-";
  if (typeof details.auditSummary === "string" && details.auditSummary.trim().length > 0) {
    return details.auditSummary;
  }
  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return "-";
  return entries
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(", ");
}

function getSeverityClasses(severity: FindingRow["severity"]) {
  if (severity === "critical") {
    return "bg-red-100 text-red-700 border-red-200";
  }
  if (severity === "high") {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  return "bg-blue-100 text-blue-700 border-blue-200";
}

function getStatusClasses(status: FindingRow["status"]) {
  if (status === "dismissed") {
    return "bg-slate-100 text-slate-700 border-slate-200";
  }
  if (status === "reviewed") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }
  return "bg-red-100 text-red-700 border-red-200";
}

export default function AuditLogPage() {
  const defaultWindow = getDefaultFindingWindow();
  const [activeTab, setActiveTab] = useState("findings");

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logPage, setLogPage] = useState(0);
  const [logEntity, setLogEntity] = useState("all");
  const [logDateFrom, setLogDateFrom] = useState("");
  const [logDateTo, setLogDateTo] = useState("");
  const [draftLogEntity, setDraftLogEntity] = useState("all");
  const [draftLogDateFrom, setDraftLogDateFrom] = useState("");
  const [draftLogDateTo, setDraftLogDateTo] = useState("");
  const [pendingRefreshCount, setPendingRefreshCount] = useState(0);
  const [knownHeadCursor, setKnownHeadCursor] = useState("none");

  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [findingsTotal, setFindingsTotal] = useState(0);
  const [findingsLoading, setFindingsLoading] = useState(true);
  const [findingsSummary, setFindingsSummary] = useState<AuditFindingSummary>(EMPTY_FINDING_SUMMARY);
  const [findingPage, setFindingPage] = useState(0);
  const [findingSeverity, setFindingSeverity] = useState("all");
  const [findingStatus, setFindingStatus] = useState("open");
  const [findingCategory, setFindingCategory] = useState("all");
  const [findingRuleKey, setFindingRuleKey] = useState("all");
  const [findingDateFrom, setFindingDateFrom] = useState(defaultWindow.from);
  const [findingDateTo, setFindingDateTo] = useState(defaultWindow.to);
  const [findingUserId, setFindingUserId] = useState("");
  const [findingCustomerId, setFindingCustomerId] = useState("");
  const [findingTransactionId, setFindingTransactionId] = useState("");
  const [draftFindingSeverity, setDraftFindingSeverity] = useState("all");
  const [draftFindingStatus, setDraftFindingStatus] = useState("open");
  const [draftFindingCategory, setDraftFindingCategory] = useState("all");
  const [draftFindingRuleKey, setDraftFindingRuleKey] = useState("all");
  const [draftFindingDateFrom, setDraftFindingDateFrom] = useState(defaultWindow.from);
  const [draftFindingDateTo, setDraftFindingDateTo] = useState(defaultWindow.to);
  const [draftFindingUserId, setDraftFindingUserId] = useState("");
  const [draftFindingCustomerId, setDraftFindingCustomerId] = useState("");
  const [draftFindingTransactionId, setDraftFindingTransactionId] = useState("");
  const [rescanLoading, setRescanLoading] = useState(false);

  const logPageSize = 50;
  const findingPageSize = 25;

  const fetchLogs = useCallback(
    async (options?: { showLoader?: boolean }) => {
      const showLoader = options?.showLoader ?? true;
      if (showLoader) setLogsLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(logPageSize),
          offset: String(logPage * logPageSize),
        });
        if (logEntity !== "all") params.set("entity", logEntity);
        if (logDateFrom) params.set("from", logDateFrom);
        if (logDateTo) params.set("to", logDateTo);

        const res = await fetch(`/api/audit?${params}`);
        if (!res.ok) throw new Error("โหลด audit log ไม่สำเร็จ");

        const data = await res.json();
        setLogs(data.logs || []);
        setLogTotal(data.total || 0);
        if (logPage === 0) {
          const head = (data.logs?.[0] as AuditEntry | undefined) || undefined;
          setKnownHeadCursor(head ? `${head.id}:${head.createdAt}` : "none");
        }
        setPendingRefreshCount(0);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "โหลด audit log ไม่สำเร็จ");
      } finally {
        if (showLoader) setLogsLoading(false);
      }
    },
    [logPage, logEntity, logDateFrom, logDateTo]
  );

  const fetchFindings = useCallback(async () => {
    setFindingsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(findingPageSize),
        offset: String(findingPage * findingPageSize),
      });
      if (findingSeverity !== "all") params.set("severity", findingSeverity);
      if (findingStatus !== "all") params.set("status", findingStatus);
      if (findingCategory !== "all") params.set("category", findingCategory);
      if (findingRuleKey !== "all") params.set("ruleKey", findingRuleKey);
      if (findingDateFrom) params.set("from", findingDateFrom);
      if (findingDateTo) params.set("to", findingDateTo);
      if (findingUserId.trim()) params.set("userId", findingUserId.trim());
      if (findingCustomerId.trim()) params.set("customerId", findingCustomerId.trim());
      if (findingTransactionId.trim()) params.set("transactionId", findingTransactionId.trim());

      const res = await fetch(`/api/audit/findings?${params}`);
      if (!res.ok) throw new Error("โหลด findings ไม่สำเร็จ");

      const data = await res.json();
      setFindings(data.findings || []);
      setFindingsTotal(data.total || 0);
      setFindingsSummary(data.summary || EMPTY_FINDING_SUMMARY);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "โหลด findings ไม่สำเร็จ");
    } finally {
      setFindingsLoading(false);
    }
  }, [
    findingPage,
    findingSeverity,
    findingStatus,
    findingCategory,
    findingRuleKey,
    findingDateFrom,
    findingDateTo,
    findingUserId,
    findingCustomerId,
    findingTransactionId,
  ]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    void fetchFindings();
  }, [fetchFindings]);

  useEffect(() => {
    let isPolling = false;

    async function pollForNewAuditEntries() {
      if (isPolling || logsLoading) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      isPolling = true;
      try {
        const params = new URLSearchParams({ limit: "1", offset: "0" });
        if (logEntity !== "all") params.set("entity", logEntity);
        if (logDateFrom) params.set("from", logDateFrom);
        if (logDateTo) params.set("to", logDateTo);

        const res = await fetch(`/api/audit?${params}`);
        if (!res.ok) return;

        const data = await res.json();
        const remoteTop = (data.logs?.[0] as AuditEntry | undefined) || undefined;
        const remoteCursor = remoteTop ? `${remoteTop.id}:${remoteTop.createdAt}` : "none";
        const localTop =
          logPage === 0
            ? logs[0]
              ? `${logs[0].id}:${logs[0].createdAt}`
              : "none"
            : knownHeadCursor;

        if (logPage !== 0 && localTop === "none") {
          setKnownHeadCursor(remoteCursor);
          return;
        }
        if (remoteCursor === localTop) return;

        const nearTop = typeof window !== "undefined" ? window.scrollY < 140 : true;
        if (logPage === 0 && nearTop && activeTab === "logs") {
          await fetchLogs({ showLoader: false });
          return;
        }

        const delta = Math.max(1, (data.total || 0) - logTotal);
        setPendingRefreshCount((prev) => Math.max(prev, delta));
      } finally {
        isPolling = false;
      }
    }

    const intervalId = window.setInterval(() => {
      void pollForNewAuditEntries();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [
    activeTab,
    fetchLogs,
    knownHeadCursor,
    logDateFrom,
    logDateTo,
    logEntity,
    logPage,
    logTotal,
    logs,
    logsLoading,
  ]);

  function applyLogFilters() {
    setLogEntity(draftLogEntity);
    setLogDateFrom(draftLogDateFrom);
    setLogDateTo(draftLogDateTo);
    setLogPage(0);
  }

  function resetLogFilters() {
    setDraftLogEntity("all");
    setDraftLogDateFrom("");
    setDraftLogDateTo("");
    setLogEntity("all");
    setLogDateFrom("");
    setLogDateTo("");
    setLogPage(0);
  }

  function applyFindingFilters() {
    setFindingSeverity(draftFindingSeverity);
    setFindingStatus(draftFindingStatus);
    setFindingCategory(draftFindingCategory);
    setFindingRuleKey(draftFindingRuleKey);
    setFindingDateFrom(draftFindingDateFrom);
    setFindingDateTo(draftFindingDateTo);
    setFindingUserId(draftFindingUserId);
    setFindingCustomerId(draftFindingCustomerId);
    setFindingTransactionId(draftFindingTransactionId);
    setFindingPage(0);
  }

  function resetFindingFilters() {
    const nextWindow = getDefaultFindingWindow();
    setDraftFindingSeverity("all");
    setDraftFindingStatus("open");
    setDraftFindingCategory("all");
    setDraftFindingRuleKey("all");
    setDraftFindingDateFrom(nextWindow.from);
    setDraftFindingDateTo(nextWindow.to);
    setDraftFindingUserId("");
    setDraftFindingCustomerId("");
    setDraftFindingTransactionId("");
    setFindingSeverity("all");
    setFindingStatus("open");
    setFindingCategory("all");
    setFindingRuleKey("all");
    setFindingDateFrom(nextWindow.from);
    setFindingDateTo(nextWindow.to);
    setFindingUserId("");
    setFindingCustomerId("");
    setFindingTransactionId("");
    setFindingPage(0);
  }

  async function handleRescan() {
    if (!findingDateFrom || !findingDateTo) {
      toast.error("กรุณาระบุช่วงวันที่ก่อนสแกน");
      return;
    }

    setRescanLoading(true);
    try {
      const payload: Record<string, unknown> = {
        startDate: findingDateFrom,
        endDate: findingDateTo,
      };
      if (findingCustomerId.trim()) payload.customerId = Number(findingCustomerId.trim());
      if (findingTransactionId.trim()) payload.transactionId = Number(findingTransactionId.trim());

      const res = await fetch("/api/audit/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "สแกนไม่สำเร็จ");

      toast.success(`สแกนใหม่สำเร็จ ${data.upsertedCount || 0} finding`);
      await fetchFindings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สแกนใหม่ไม่สำเร็จ");
    } finally {
      setRescanLoading(false);
    }
  }

  async function updateFindingStatus(id: number, status: FindingRow["status"]) {
    try {
      const reviewNote =
        status === "dismissed"
          ? window.prompt("บันทึกหมายเหตุสำหรับการปิด finding นี้ (ถ้าไม่มีกดตกลงได้เลย)") || ""
          : "";

      const res = await fetch(`/api/audit/findings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "อัปเดตสถานะไม่สำเร็จ");

      toast.success("อัปเดตสถานะ finding แล้ว");
      await fetchFindings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  const logTotalPages = Math.ceil(logTotal / logPageSize);
  const findingTotalPages = Math.ceil(findingsTotal / findingPageSize);
  const summaryCards = buildAuditSummaryCards(findingsSummary);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Monitor</h1>
          <p className="text-sm text-muted-foreground">
            ติดตามการเคลื่อนไหวของรายการขาย พร้อมโฟกัส fraud จาก cancel, order anomaly, และ payment abuse
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Findings {findingsTotal.toLocaleString()} รายการ</span>
          <span>Log {logTotal.toLocaleString()} รายการ</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.key} className="py-4">
            <CardHeader className="px-4 pb-0">
              <CardTitle className="text-sm">{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div
                className={cn(
                  "text-3xl font-bold",
                  card.tone === "danger"
                    ? "text-red-700"
                    : card.tone === "warning"
                      ? "text-amber-700"
                      : "text-foreground"
                )}
              >
                {card.value.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-4">
          <Card className="py-4">
            <CardHeader className="px-4 pb-2">
              <CardTitle className="text-base">ตัวกรอง Findings</CardTitle>
              <CardDescription>
                กรองเฉพาะ fraud signal ตามหมวด กฎ ผู้ใช้ ลูกค้า และเลขรายการ
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-6">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Severity</label>
                  <Select value={draftFindingSeverity} onValueChange={setDraftFindingSeverity}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ทั้งหมด</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Status</label>
                  <Select value={draftFindingStatus} onValueChange={setDraftFindingStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">ทั้งหมด</SelectItem>
                      <SelectItem value="open">ยังไม่ตรวจ</SelectItem>
                      <SelectItem value="reviewed">ตรวจแล้ว</SelectItem>
                      <SelectItem value="dismissed">ปิดรายการ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">หมวด</label>
                    <Select value={draftFindingCategory} onValueChange={setDraftFindingCategory}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FINDING_CATEGORY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">กฎ</label>
                  <Select value={draftFindingRuleKey} onValueChange={setDraftFindingRuleKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FINDING_RULE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">จากวันที่</label>
                  <Input
                    type="date"
                    value={draftFindingDateFrom}
                    onChange={(event) => setDraftFindingDateFrom(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">ถึงวันที่</label>
                  <Input
                    type="date"
                    value={draftFindingDateTo}
                    onChange={(event) => setDraftFindingDateTo(event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">User ID</label>
                  <Input
                    value={draftFindingUserId}
                    onChange={(event) => setDraftFindingUserId(event.target.value)}
                    placeholder="เช่น 12"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Customer ID</label>
                  <Input
                    value={draftFindingCustomerId}
                    onChange={(event) => setDraftFindingCustomerId(event.target.value)}
                    placeholder="เช่น 302"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Transaction ID</label>
                  <Input
                    value={draftFindingTransactionId}
                    onChange={(event) => setDraftFindingTransactionId(event.target.value)}
                    placeholder="เช่น 8891"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={applyFindingFilters}>
                  Apply
                </Button>
                <Button size="sm" variant="outline" onClick={resetFindingFilters}>
                  Reset
                </Button>
                <Button size="sm" onClick={() => void handleRescan()} disabled={rescanLoading}>
                  {rescanLoading ? "กำลังสแกน..." : "Rescan ช่วงนี้"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {findingsLoading ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  กำลังโหลด findings...
                </CardContent>
              </Card>
            ) : findings.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  ไม่พบ finding ตามเงื่อนไขที่เลือก
                </CardContent>
              </Card>
            ) : (
              findings.map((finding) => (
                <Card key={finding.id} className="py-4">
                  <CardHeader className="px-4 pb-2">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={cn("border", getSeverityClasses(finding.severity))}>
                            {finding.severity.toUpperCase()}
                          </Badge>
                          <Badge className={cn("border", getStatusClasses(finding.status))}>
                            {FINDING_STATUS_LABELS[finding.status]}
                          </Badge>
                          <Badge variant="outline">
                            {FINDING_CATEGORY_LABELS[finding.category]}
                          </Badge>
                          <Badge variant="outline">{getFindingRuleLabel(finding.ruleKey)}</Badge>
                        </div>
                        <CardTitle className="text-base">
                          {finding.title} <span className="text-sm text-muted-foreground">score {finding.riskScore}</span>
                        </CardTitle>
                        <CardDescription>{finding.reason}</CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {finding.status !== "reviewed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateFindingStatus(finding.id, "reviewed")}
                          >
                            ทำเครื่องหมายว่าตรวจแล้ว
                          </Button>
                        )}
                        {finding.status !== "dismissed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateFindingStatus(finding.id, "dismissed")}
                          >
                            ปิดรายการ
                          </Button>
                        )}
                        {finding.status !== "open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateFindingStatus(finding.id, "open")}
                          >
                            เปิดใหม่
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4">
                    <div className="grid gap-3 text-sm lg:grid-cols-[1.2fr_1.8fr]">
                      <div className="space-y-1 text-muted-foreground">
                        <p>ล่าสุด: {formatDateTime(finding.lastSeenAt)}</p>
                        <p>ครั้งแรก: {formatDateTime(finding.firstSeenAt)}</p>
                        <p>
                          ผู้ใช้: {finding.username || "-"} {finding.userId ? `(ID ${finding.userId})` : ""}
                        </p>
                        <p>
                          ลูกค้า: {finding.customerId ? `#${finding.customerId}` : "-"} | รายการ:{" "}
                          {finding.transactionId ? `#${finding.transactionId}` : "-"}
                        </p>
                        <p>
                          entity: {finding.entity}
                          {finding.entityId ? ` #${finding.entityId}` : ""}
                        </p>
                        {finding.reviewNote && <p>หมายเหตุ: {finding.reviewNote}</p>}
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                        {formatFindingEvidencePreview(finding.evidence)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {findingTotalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                หน้า {findingPage + 1} จาก {findingTotalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={findingPage === 0}
                  onClick={() => setFindingPage((page) => page - 1)}
                >
                  ก่อนหน้า
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={findingPage >= findingTotalPages - 1}
                  onClick={() => setFindingPage((page) => page + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          {pendingRefreshCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-sm text-blue-900">
                มี log ใหม่ {pendingRefreshCount.toLocaleString()} รายการ
              </p>
              <Button
                size="sm"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  if (logPage !== 0) {
                    setLogPage(0);
                    setPendingRefreshCount(0);
                    return;
                  }
                  void fetchLogs({ showLoader: false });
                }}
              >
                โหลดล่าสุด
              </Button>
            </div>
          )}

          <Card className="py-4">
            <CardHeader className="px-4 pb-2">
              <CardTitle className="text-base">ตัวกรอง Logs</CardTitle>
              <CardDescription>ดู raw audit trail ของการสร้าง ชำระ ยกเลิก และซิงค์</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-end">
                <div className="col-span-2 md:col-span-1">
                  <label className="mb-1 block text-xs text-muted-foreground">ประเภท</label>
                  <Select value={draftLogEntity} onValueChange={setDraftLogEntity}>
                    <SelectTrigger className="w-full md:w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">จาก</label>
                  <Input
                    type="date"
                    value={draftLogDateFrom}
                    onChange={(event) => setDraftLogDateFrom(event.target.value)}
                    className="w-full md:w-40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">ถึง</label>
                  <Input
                    type="date"
                    value={draftLogDateTo}
                    onChange={(event) => setDraftLogDateTo(event.target.value)}
                    className="w-full md:w-40"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={applyLogFilters}>
                  Apply
                </Button>
                <Button variant="outline" size="sm" onClick={resetLogFilters}>
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-[720px] w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left font-medium">เวลา</th>
                  <th className="p-3 text-left font-medium">ผู้ใช้</th>
                  <th className="p-3 text-left font-medium">การกระทำ</th>
                  <th className="p-3 text-left font-medium">ประเภท</th>
                  <th className="p-3 text-left font-medium">ID</th>
                  <th className="p-3 text-left font-medium">รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      ไม่พบข้อมูล
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-t align-top hover:bg-muted/30">
                      <td className="p-3 whitespace-nowrap text-xs">{formatDateTime(log.createdAt)}</td>
                      <td className="p-3 whitespace-nowrap font-medium">{log.username}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                          {getAuditActionLabel(log)}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{log.entity}</td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">{log.entityId ?? "-"}</td>
                      <td className="p-3 text-xs text-muted-foreground">{formatDetails(log.details)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {logTotalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                หน้า {logPage + 1} จาก {logTotalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={logPage === 0}
                  onClick={() => setLogPage((page) => page - 1)}
                >
                  ก่อนหน้า
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={logPage >= logTotalPages - 1}
                  onClick={() => setLogPage((page) => page + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
