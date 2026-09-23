export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-6 shadow-card print:border-0 print:p-0 print:shadow-none ${className}`}>
      {children}
    </div>
  );
}
