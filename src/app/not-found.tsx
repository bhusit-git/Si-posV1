import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 bg-background text-foreground">
      <div className="text-8xl font-bold text-muted-foreground/30">404</div>
      <h1 className="text-3xl font-bold">ไม่พบหน้าที่ต้องการ</h1>
      <p className="text-muted-foreground text-center max-w-md">
        หน้าที่คุณเข้าชมไม่มีอยู่ในระบบ หรืออาจถูกย้ายไปแล้ว
      </p>
      <Link
        href="/modules"
        className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
      >
        กลับหน้าหลัก
      </Link>
    </div>
  );
}
