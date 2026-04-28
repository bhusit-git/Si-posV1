export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="print-layout notranslate bg-white min-h-screen"
      translate="no"
    >
      {children}
    </div>
  );
}
