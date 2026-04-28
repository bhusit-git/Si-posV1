"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  readShowCustomerIdWithName,
  writeShowCustomerIdWithName,
} from "@/lib/customer-display";

interface User {
  id: number;
  username: string;
  role: string;
  factoryKey: string | null;
}

interface FactoryInfo {
  key: string;
  name: string;
}

const LOCKED_ROLES = ["manager", "factory"];
const ROLE_LABELS: Record<string, string> = {
  admin: "ผู้ดูแลระบบ",
  office: "สำนักงาน",
  manager: "ผู้จัดการ",
  factory: "โรงงาน",
};

type BackupAction =
  | "transactionsJson"
  | "customersJson"
  | "fullJson"
  | "transactionsCsv"
  | "customersCsv"
  | "fullCsv";

export default function SettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // User management (admin)
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("office");
  const [newUserFactoryKey, setNewUserFactoryKey] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");
  const [userSaving, setUserSaving] = useState(false);

  // Factory switcher
  const [factories, setFactories] = useState<FactoryInfo[]>([]);
  const [currentFactory, setCurrentFactory] = useState("");
  const [multiFactory, setMultiFactory] = useState(false);
  const [switchingFactory, setSwitchingFactory] = useState(false);
  const [showCustomerIdWithName, setShowCustomerIdWithName] = useState(true);
  const [backupLoadingAction, setBackupLoadingAction] = useState<BackupAction | null>(null);

  const canSwitchFactory = user && !user.factoryKey && ["admin", "office"].includes(user.role);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          setUser(data);
          if (data.role === "admin") {
            loadUsers();
          }
          loadFactories();
        }
      });
  }, []);

  useEffect(() => {
    setShowCustomerIdWithName(readShowCustomerIdWithName(true));
  }, []);

  async function loadUsers() {
    const res = await fetch("/api/users");
    if (res.ok) {
      const data = await res.json();
      setAllUsers(data);
    }
  }

  async function loadFactories() {
    try {
      const res = await fetch("/api/factory");
      if (res.ok) {
        const data = await res.json();
        setFactories(data.factories || []);
        setCurrentFactory(data.current || "");
        setMultiFactory(data.multiFactory || false);
      }
    } catch {
      // Factory endpoint not available
    }
  }

  function factoryName(key: string | null): string {
    if (!key) return "-";
    return factories.find((f) => f.key === key)?.name || key;
  }

  async function handleSwitchFactory(factoryKey: string) {
    if (factoryKey === currentFactory) return;
    setSwitchingFactory(true);
    try {
      const res = await fetch("/api/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factory: factoryKey }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentFactory(data.current);
        toast.success(`เปลี่ยนโรงงานเป็น ${data.name} สำเร็จ`);
        window.location.reload();
      } else {
        const data = await res.json();
        toast.error(data.error || "เปลี่ยนโรงงานไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      setSwitchingFactory(false);
    }
  }

  async function handleChangePassword() {
    setMessage("");
    setError("");

    if (!currentPassword) {
      setError("กรุณาใส่รหัสผ่านปัจจุบัน");
      return;
    }
    if (!newPassword) {
      setError("กรุณาใส่รหัสผ่านใหม่");
      return;
    }
    if (newPassword.length < 4) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่ไม่ตรงกัน");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("เปลี่ยนรหัสผ่านสำเร็จ");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setError(data.error || "เกิดข้อผิดพลาด");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddUser() {
    if (!newUsername || !newUserPassword) {
      setUserError("ต้องระบุชื่อผู้ใช้และรหัสผ่าน");
      return;
    }
    if (newUserPassword.length < 4) {
      setUserError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    if (LOCKED_ROLES.includes(newUserRole) && !newUserFactoryKey) {
      setUserError("ต้องระบุโรงงานสำหรับบทบาทนี้");
      return;
    }
    setUserSaving(true);
    setUserError("");
    setUserMessage("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newUserPassword,
          role: newUserRole,
          factoryKey: LOCKED_ROLES.includes(newUserRole) ? newUserFactoryKey : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUserMessage(`เพิ่มผู้ใช้ ${data.username} สำเร็จ`);
        setAddDialogOpen(false);
        setNewUsername("");
        setNewUserPassword("");
        setNewUserRole("office");
        setNewUserFactoryKey("");
        loadUsers();
      } else {
        setUserError(data.error || "เกิดข้อผิดพลาด");
      }
    } finally {
      setUserSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!selectedUser || !resetPassword) return;
    if (resetPassword.length < 4) {
      setUserError("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    setUserSaving(true);
    setUserError("");
    setUserMessage("");
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedUser.id, newPassword: resetPassword }),
      });
      if (res.ok) {
        setUserMessage(`รีเซ็ตรหัสผ่านของ ${selectedUser.username} สำเร็จ`);
        setResetDialogOpen(false);
        setResetPassword("");
      }
    } finally {
      setUserSaving(false);
    }
  }

  async function handleChangeRole(userId: number, newRole: string) {
    await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, role: newRole }),
    });
    loadUsers();
  }

  async function handleChangeFactoryKey(userId: number, fk: string) {
    await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, factoryKey: fk || null }),
    });
    loadUsers();
  }

  async function handleDeleteUser(u: User) {
    if (!confirm(`ยืนยันการลบผู้ใช้ "${u.username}"?`)) return;
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    if (res.ok) {
      setUserMessage(`ลบผู้ใช้ ${u.username} สำเร็จ`);
      loadUsers();
    } else {
      const data = await res.json();
      setUserError(data.error || "ไม่สามารถลบได้");
    }
  }

  function handleToggleCustomerIdWithName(next: boolean) {
    setShowCustomerIdWithName(next);
    writeShowCustomerIdWithName(next);
    toast.success(next ? "แสดงรหัสลูกค้าหน้าชื่อแล้ว" : "ซ่อนรหัสลูกค้าหน้าชื่อแล้ว");
  }

  async function readBackupErrorMessage(res: Response): Promise<string> {
    const contentType = res.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      const payload = await res.json().catch(() => null);
      if (payload?.error) return String(payload.error);
    }

    const text = await res.text().catch(() => "");
    if (text.trim()) {
      return `ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`;
    }
    return `ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`;
  }

  async function downloadBackupFile(params: {
    action: BackupAction;
    endpoint: string;
    fallbackFilename: string;
    loadingMessage: string;
  }) {
    if (backupLoadingAction) return;

    const { action, endpoint, fallbackFilename, loadingMessage } = params;
    setBackupLoadingAction(action);
    toast.info(loadingMessage);

    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        const message = await readBackupErrorMessage(res);
        toast.error(message);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || fallbackFilename;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`ดาวน์โหลดสำเร็จ: ${filename}`);
    } catch {
      toast.error("เกิดข้อผิดพลาดระหว่างดาวน์โหลดไฟล์");
    } finally {
      setBackupLoadingAction(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">ตั้งค่า</h1>
        <p className="text-sm text-gray-500">จัดการบัญชีผู้ใช้</p>
      </div>

      {/* Factory Switcher (admin/office with no factory lock) */}
      {canSwitchFactory && multiFactory && factories.length > 1 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">โรงงาน (Factory)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 mb-3">
              เลือกฐานข้อมูลโรงงานที่ต้องการใช้งาน
            </p>
            <div className="flex flex-wrap gap-2">
              {factories.map((f) => (
                <Button
                  key={f.key}
                  variant={currentFactory === f.key ? "default" : "outline"}
                  size="sm"
                  disabled={switchingFactory}
                  onClick={() => handleSwitchFactory(f.key)}
                  className="min-w-[100px]"
                >
                  {currentFactory === f.key && (
                    <span className="mr-1.5 inline-block w-2 h-2 rounded-full bg-green-400" />
                  )}
                  {f.name}
                </Button>
              ))}
            </div>
            {switchingFactory && (
              <p className="text-sm text-gray-400 mt-2">กำลังเปลี่ยนโรงงาน...</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Locked factory indicator for manager/factory roles */}
      {user?.factoryKey && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">โรงงาน (Factory)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-medium">{factoryName(user.factoryKey)}</span>
              <Badge variant="outline" className="text-xs ml-2">ผูกกับโรงงานนี้</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current User Info */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">การแสดงผลบิล</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={showCustomerIdWithName}
              onChange={(e) => handleToggleCustomerIdWithName(e.target.checked)}
            />
            <span>
              <span className="font-medium text-sm">แสดงรหัสลูกค้าหน้าชื่อ</span>
              <p className="text-xs text-gray-500 mt-1">
                ตัวอย่าง: `123 | ลูกค้า A` (ใช้กับหน้ารายการบิล, ค้าง, เครดิต, สมุดรายวัน, ใบวางบิล)
              </p>
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Current User Info */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ข้อมูลผู้ใช้</CardTitle>
        </CardHeader>
        <CardContent>
          {user ? (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">ชื่อผู้ใช้</span>
                <span className="font-medium">{user.username}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">สิทธิ์</span>
                <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                  {ROLE_LABELS[user.role] || user.role}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">กำลังโหลด...</p>
          )}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">เปลี่ยนรหัสผ่าน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>รหัสผ่านปัจจุบัน</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="ใส่รหัสผ่านปัจจุบัน"
            />
          </div>
          <div className="space-y-2">
            <Label>รหัสผ่านใหม่</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="ใส่รหัสผ่านใหม่"
            />
            <p className="text-xs text-gray-500">ใช้รหัสผ่านอย่างน้อย 4 ตัวอักษร</p>
          </div>
          <div className="space-y-2">
            <Label>ยืนยันรหัสผ่านใหม่</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="ใส่รหัสผ่านใหม่อีกครั้ง"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}
          <Button onClick={handleChangePassword} disabled={saving} className="w-full">
            {saving ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}
          </Button>
        </CardContent>
      </Card>

      {/* User Management (Admin Only) */}
      {user?.role === "admin" && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">จัดการผู้ใช้</CardTitle>
              <Button size="sm" onClick={() => { setAddDialogOpen(true); setUserError(""); }}>
                เพิ่มผู้ใช้
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {userMessage && <p className="text-sm text-green-600 mb-3">{userMessage}</p>}
            {userError && <p className="text-sm text-red-600 mb-3">{userError}</p>}
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  <TableHead>ชื่อผู้ใช้</TableHead>
                  <TableHead>สิทธิ์</TableHead>
                  <TableHead>โรงงาน</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">{u.id}</TableCell>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(val) => handleChangeRole(u.id, val)}
                      >
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                          <SelectItem value="office">สำนักงาน</SelectItem>
                          <SelectItem value="manager">ผู้จัดการ</SelectItem>
                          <SelectItem value="factory">โรงงาน</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {LOCKED_ROLES.includes(u.role) ? (
                        <Select
                          value={u.factoryKey || ""}
                          onValueChange={(val) => handleChangeFactoryKey(u.id, val)}
                        >
                          <SelectTrigger className="w-32 h-8 text-xs">
                            <SelectValue placeholder="เลือกโรงงาน" />
                          </SelectTrigger>
                          <SelectContent>
                            {factories.map((f) => (
                              <SelectItem key={f.key} value={f.key}>{f.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-gray-400">ทุกโรงงาน</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            setSelectedUser(u);
                            setResetPassword("");
                            setResetDialogOpen(true);
                            setUserError("");
                          }}
                        >
                          รีเซ็ต
                        </Button>
                        {u.id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-red-600"
                            onClick={() => handleDeleteUser(u)}
                          >
                            ลบ
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Backup (Admin Only) */}
      {user?.role === "admin" && (
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">สำรองข้อมูล</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-500">
              ดาวน์โหลดเฉพาะข้อมูลของโรงงานที่เลือกอยู่ตอนนี้ ({factoryName(currentFactory || null)})
            </p>
            <p className="text-sm text-gray-500">
              JSON ใช้สำหรับ backup/restore โดยตรง และ CSV ZIP ใช้สำหรับ Excel/รายงาน
            </p>
            <Button
              variant="outline"
              onClick={() =>
                downloadBackupFile(
                  {
                    action: "transactionsJson",
                    endpoint: "/api/backup/transactions",
                    fallbackFilename: `superice-transactions-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    loadingMessage: "กำลังเตรียมข้อมูลรายการขาย (JSON)...",
                  }
                )
              }
              disabled={backupLoadingAction !== null}
              className="w-full"
            >
              {backupLoadingAction === "transactionsJson"
                ? "กำลังดาวน์โหลด..."
                : "ดาวน์โหลดข้อมูลรายการขายทั้งหมด (JSON)"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadBackupFile(
                  {
                    action: "customersJson",
                    endpoint: "/api/backup/customers",
                    fallbackFilename: `superice-customers-metadata-${new Date().toISOString().slice(0, 10)}.json`,
                    loadingMessage: "กำลังเตรียมข้อมูลลูกค้า (JSON)...",
                  }
                )
              }
              disabled={backupLoadingAction !== null}
              className="w-full"
            >
              {backupLoadingAction === "customersJson"
                ? "กำลังดาวน์โหลด..."
                : "ดาวน์โหลดข้อมูลลูกค้า (Metadata) (JSON)"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadBackupFile(
                  {
                    action: "fullJson",
                    endpoint: "/api/backup",
                    fallbackFilename: `superice-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    loadingMessage: "กำลังเตรียมข้อมูลทั้งหมด (JSON)...",
                  }
                )
              }
              disabled={backupLoadingAction !== null}
              className="w-full"
            >
              {backupLoadingAction === "fullJson"
                ? "กำลังดาวน์โหลด..."
                : "ดาวน์โหลดข้อมูลสำรอง (JSON)"}
            </Button>

            <div className="pt-2 border-t">
              <p className="text-xs text-gray-500 mb-3">CSV ZIP (แยกไฟล์รายตาราง)</p>
              <div className="space-y-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadBackupFile({
                      action: "transactionsCsv",
                      endpoint: "/api/backup/csv?scope=transactions",
                      fallbackFilename: `superice-transactions-csv-export-${new Date().toISOString().slice(0, 10)}.zip`,
                      loadingMessage: "กำลังเตรียมไฟล์ CSV รายการขาย...",
                    })
                  }
                  disabled={backupLoadingAction !== null}
                  className="w-full"
                >
                  {backupLoadingAction === "transactionsCsv"
                    ? "กำลังดาวน์โหลด..."
                    : "ดาวน์โหลดข้อมูลรายการขาย (CSV ZIP)"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadBackupFile({
                      action: "customersCsv",
                      endpoint: "/api/backup/csv?scope=customers",
                      fallbackFilename: `superice-customers-csv-export-${new Date().toISOString().slice(0, 10)}.zip`,
                      loadingMessage: "กำลังเตรียมไฟล์ CSV ลูกค้า...",
                    })
                  }
                  disabled={backupLoadingAction !== null}
                  className="w-full"
                >
                  {backupLoadingAction === "customersCsv"
                    ? "กำลังดาวน์โหลด..."
                    : "ดาวน์โหลดข้อมูลลูกค้า (CSV ZIP)"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadBackupFile({
                      action: "fullCsv",
                      endpoint: "/api/backup/csv?scope=full",
                      fallbackFilename: `superice-full-csv-export-${new Date().toISOString().slice(0, 10)}.zip`,
                      loadingMessage: "กำลังเตรียมไฟล์ CSV ทั้งระบบ...",
                    })
                  }
                  disabled={backupLoadingAction !== null}
                  className="w-full"
                >
                  {backupLoadingAction === "fullCsv"
                    ? "กำลังดาวน์โหลด..."
                    : "ดาวน์โหลดข้อมูลทั้งหมด (CSV ZIP)"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มผู้ใช้ใหม่</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>ชื่อผู้ใช้</Label>
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="username" />
            </div>
            <div className="space-y-2">
              <Label>รหัสผ่าน</Label>
              <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="password" />
              <p className="text-xs text-gray-500">ใช้รหัสผ่านอย่างน้อย 4 ตัวอักษร</p>
            </div>
            <div className="space-y-2">
              <Label>สิทธิ์</Label>
              <Select value={newUserRole} onValueChange={(val) => { setNewUserRole(val); if (!LOCKED_ROLES.includes(val)) setNewUserFactoryKey(""); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                  <SelectItem value="office">สำนักงาน</SelectItem>
                  <SelectItem value="manager">ผู้จัดการ</SelectItem>
                  <SelectItem value="factory">โรงงาน</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {LOCKED_ROLES.includes(newUserRole) && (
              <div className="space-y-2">
                <Label>โรงงานที่ผูก</Label>
                <Select value={newUserFactoryKey} onValueChange={setNewUserFactoryKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกโรงงาน" />
                  </SelectTrigger>
                  <SelectContent>
                    {factories.map((f) => (
                      <SelectItem key={f.key} value={f.key}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">ผู้ใช้จะเข้าถึงได้เฉพาะโรงงานนี้เท่านั้น</p>
              </div>
            )}
            {userError && <p className="text-sm text-red-600">{userError}</p>}
            <Button onClick={handleAddUser} disabled={userSaving} className="w-full">
              {userSaving ? "กำลังบันทึก..." : "เพิ่มผู้ใช้"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>รีเซ็ตรหัสผ่าน: {selectedUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>รหัสผ่านใหม่</Label>
              <Input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="รหัสผ่านใหม่" />
              <p className="text-xs text-gray-500">ใช้รหัสผ่านอย่างน้อย 4 ตัวอักษร</p>
            </div>
            {userError && <p className="text-sm text-red-600">{userError}</p>}
            <Button onClick={handleResetPassword} disabled={userSaving || !resetPassword} className="w-full">
              {userSaving ? "กำลังบันทึก..." : "รีเซ็ตรหัสผ่าน"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
