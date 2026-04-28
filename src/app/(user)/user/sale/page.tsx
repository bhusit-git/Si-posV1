import SalePage from "@/app/(dashboard)/sale/page";

export default function UserSalePage() {
  return (
    <div className="user-sale-wrapper">
      <SalePage />
      {/* Push mobile sticky bar above the bottom tab bar */}
      <style>{`
        .user-sale-wrapper { padding-bottom: 3.5rem; }
        .user-sale-wrapper .fixed.bottom-0.z-30 { bottom: 3rem; }
      `}</style>
    </div>
  );
}
