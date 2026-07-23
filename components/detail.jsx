"use client";

// ===== KHOI THONG TIN DANG NHAN - GIA TRI =====
// rows: [[nhan, giatri], ...] — dong nao gia tri rong se tu an
export function InfoRows({ rows, className = "" }) {
  const list = (rows || []).filter((r) => {
    if (!r) return false;
    const v = r[1];
    return !(v === null || v === undefined || v === "" || v === false);
  });
  if (list.length === 0) return null;
  return (
    <div className={`card !p-0 overflow-hidden ${className}`}>
      {list.map(([k, v], i) => (
        <div key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5 border-b border-dashed border-[#E3E8EF] last:border-b-0 text-[13.5px]">
          <span className="text-[#5A6572] shrink-0">{k}</span>
          <span className="text-right font-semibold min-w-0 break-words">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ===== BANG TIEN CO DONG KET LUAN =====
// lines: [[nhan, giatri, class?], ...]  |  total: { label, value, done }
export function MoneyRows({ lines, total, className = "" }) {
  return (
    <div className={`rounded-xl border border-[#E3E8EF] overflow-hidden ${className}`}>
      {(lines || []).filter(Boolean).map(([k, v, cls], i) => (
        <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
          <span className="text-[#5A6572]">{k}</span>
          <span className={cls || "font-bold"}>{v}</span>
        </div>
      ))}
      {total && (
        <div className={`flex items-center justify-between px-3 py-2.5 ${total.done ? "bg-[#E7F6EE]" : "bg-[#FFF6E5]"}`}>
          <span className="font-bold text-[13.5px]">{total.label}</span>
          <span className={`text-[17px] font-extrabold ${total.done ? "text-[#0E7A4A]" : "text-[#A25F00]"}`}>{total.value}</span>
        </div>
      )}
    </div>
  );
}

// ===== NHAT KY THAO TAC =====
export function AuditLog({ logs, labels = {}, title = "Nhật ký", empty = "Chưa có thao tác nào." }) {
  const fmt = (d) => d ? new Date(d).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const list = logs || [];
  return (
    <div className="card">
      <div className="font-extrabold mb-2">{title} ({list.length})</div>
      {list.length === 0 ? <div className="text-sm text-[#8A93A0]">{empty}</div> : (
        <div className="max-h-56 overflow-y-auto pr-1">
          {list.map((lg, i) => (
            <div key={lg.id ?? i} className="flex items-start gap-2 py-1.5 border-b border-dashed border-[#EEF1F4] last:border-b-0 text-[12.5px]">
              <span className="text-[#8A93A0] whitespace-nowrap">{fmt(lg.acted_at || lg.created_at)}</span>
              <span className="text-[#8A93A0]">·</span>
              <span className="text-[#5A6572] truncate">{lg.acted_by_name || lg.by_name || lg.user_name || lg.created_by_name || "—"}</span>
              <span className="ml-auto font-semibold text-right whitespace-nowrap">
                {labels[lg.action] || labels[lg.txn_type] || lg.action || lg.txn_type || lg.note || "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
