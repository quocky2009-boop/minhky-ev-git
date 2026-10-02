// Dong thong tin noi nhan tien cua 1 khoan thanh toan: tai khoan ngan hang (ngan hang nao, phap nhan nao, so TK)
// hoac quy tien mat (diem nao); tra gop: don vi tra gop.
export default function PayAccountInfo({ p, accs = [], cos = [], locations = [], extra }) {
  const a = p.account_id ? accs.find((x) => x.id === p.account_id) : null;
  if (p.method === "Trả góp" || p.finance_company) {
    const cty = p.finance_company || extra?.tra_gop_cong_ty;
    return <div className="text-[11.5px] text-[#A25F00]">🏛 Đơn vị trả góp: <b>{cty || "—"}</b>{p.status && p.status !== "Đã thu" ? ` · ${p.status}` : ""}</div>;
  }
  if (!a) return <div className="text-[11.5px] text-[#8A93A0]">{p.cash_txn_code ? `Phiếu thu ${p.cash_txn_code}` : "Chưa ghi nhận tài khoản/quỹ"}</div>;
  if (a.type === "Ngân hàng") {
    const co = cos.find((c) => c.id === a.company_id)?.name;
    return (
      <div className="text-[11.5px] text-brand">
        🏦 <b>{a.name}</b>{a.bank_info ? <> · <span className="font-mono">{a.bank_info}</span></> : null}{co ? <> · Pháp nhân: <b>{co}</b></> : null}
        {p.cash_txn_code ? <span className="text-[#8A93A0]"> · {p.cash_txn_code}</span> : null}
      </div>
    );
  }
  const diem = locations.find((l) => l.code === a.location_code)?.name;
  return (
    <div className="text-[11.5px] text-[#A25F00]">
      💵 <b>{a.name}</b>{diem ? <> · Điểm: <b>{diem}</b></> : null}
      {p.cash_txn_code ? <span className="text-[#8A93A0]"> · {p.cash_txn_code}</span> : null}
    </div>
  );
}
