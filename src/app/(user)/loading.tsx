export default function UserLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      <p className="text-muted-foreground animate-pulse">กำลังโหลด...</p>
    </div>
  );
}
