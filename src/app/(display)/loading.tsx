export default function DisplayLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4">
      <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-400 text-lg animate-pulse">กำลังโหลดหน้าจอ...</p>
    </div>
  );
}
