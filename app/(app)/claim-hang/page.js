"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast, KPI, MoneyInput } from "@/components/ui";
import { fmtVND, fmtDate, errMsg } from "@/lib/format";

const ST = {
  NHAP: { label: "Nháp (chưa nộp hãng)", tone: "gray" },
  DA_NOP: { label: "Đã nộp hãng — chờ duyệt", tone: "amber" },
  HANG_DUYET: { label: "Hãng đã duyệt — chờ đối trừ", tone: "blue" },
  DA_DOI_TRU: { label: "Đã đối trừ xong", tone: "green" },
  HUY: { label: "Đã hủy", tone: "dark" },
};
const KQ = { DUYET: "Hãng duyệt", TU_CHOI_BO_SUNG: "Từ chối — bổ sung hồ sơ, nộp lại", TU_CHOI_MAT: "Từ chối hẳn (không được trả)" };
const LOAI = { NHAP_XE: "Hóa đơn nhập lô xe", NHAP_PHU_TUNG: "Công nợ / đơn nhập phụ tùng", KHAC: "Khác" };

export default function ClaimHang() {
  const { supabase, profile, loading, settings, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [tab, setTab] = useState("cho");
  const [cho, setCho] = useState([]);
  const [claims, setClaims] = useState([]);
  const [dongs, setDongs] = useState([]);
  const [congNo, setCongNo] = useState([]);
  const [doiTru, setDoiTru] = useState([]);
  const [debts, setDebts] = useState([]);
  const [soDu, setSoDu] = useState(0);
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [kq, setKq] = useState({});          // dong id -> {ket_qua, ly_do}
  const [nopF, setNopF] = useState({ so_ho_so: "", ngay_nop: "" });
  const [dt, setDt] = useState(null);        // form doi tru
  const [ngayChot, setNgayChot] = useState(null);
  const [perms, setPerms] = useState({});

  const isCeo = profile?.role === "CEO";
  const can = isCeo || !!perms.claim_hang;
  const hom_nay = new Date().toLocaleDateString("sv-SE");

  const load = async () => {
    if (!profile) return;
    const [a, b, c, d, e, f, g, pm] = await Promise.all([
      supabase.rpc("fn_claim_cho"),
      supabase.from("hang_claim").select("*").order("id", { ascending: false }).limit(200),
      supabase.from("hang_claim_dong").select("*").order("id"),
      supabase.from("hang_cong_no").select("*").order("id", { ascending: false }),
      supabase.from("hang_doi_tru").select("*").order("id", { ascending: false }).limit(300),
      supabase.from("supplier_debts").select("id,code,import_doc,supplier,tong_tien,da_tra,con_no,status").gt("con_no", 0),
      supabase.from("v_quy_so_du").select("so_du,name").eq("name", "Cty VinFast Việt Nam"),
      supabase.from("role_perms").select("perm,allowed").eq("role", profile.role),
    ]);
    setCho(a.data || []); setClaims(b.data || []); setDongs(c.data || []); setCongNo(d.data || []); setDoiTru(e.data || []);
    setDebts(f.data || []); setSoDu(Number(g.data?.[0]?.so_du || 0));
    const m = {}; (pm.data || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
  };
  useEffect(() => { if (!loading) load(); }, [loading, profile]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  if (!["CEO", "ADMIN", "MANAGER"].includes(profile.role)) return <div className="card">Bạn không có quyền xem mục này.</div>;

  const act = async (fn, args, okMsg) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { notify(errMsg(error), "err"); return null; }
    if (okMsg) notify(okMsg);
    await load();
    return data ?? true;
  };

  const ngayChotStr = settings?.claim_ngay_chot || "";
  const ngayChotArr = ngayChotStr.split(",").map((x) => x.trim()).filter(Boolean);
  const homChot = ngayChotArr.includes(String(new Date().getDate()));
  const tongCho = cho.reduce((a, b) => a + b.so_tien, 0);
  const quaHan = cho.filter((x) => x.so_ngay > 15);
  const choDuyet = claims.filter((c) => c.status === "DA_NOP");
  const conNo = congNo.reduce((a, b) => a + (b.so_tien - b.da_doi_tru), 0);
  const selIds = cho.filter((x) => pick[x.payment_id]).map((x) => x.payment_id);
  const selTong = cho.filter((x) => pick[x.payment_id]).reduce((a, b) => a + b.so_tien, 0);
  const claimOf = (id) => claims.find((c) => c.id === id);

  const lap = async () => {
    if (selIds.length === 0) return notify("Chọn các khoản cần claim.", "err");
    const ky = prompt(`Lập hồ sơ claim ${selIds.length} khoản — ${fmtVND(selTong)}.\nKỳ claim (VD: T10/2026):`, `T${new Date().getMonth() + 1}/${new Date().getFullYear()}`);
    if (ky === null) return;
    const ok = await act("fn_claim_lap", { p: { payment_ids: selIds, ky_claim: ky } }, "Đã lập hồ sơ claim (nháp).");
    if (ok) { setPick({}); setTab("ho_so"); }
  };

  const tabBtn = (k, label) => (
    <button key={k} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? "bg-brand text-white" : "bg-[#EEF1F4] text-[#5A6572]"}`} onClick={() => setTab(k)}>{label}</button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-extrabold text-lg mr-auto">Claim hãng — tiền khách trả thẳng cho VinFast</div>
        <div className="flex gap-1.5 flex-wrap">
          {tabBtn("cho", `Chờ claim (${cho.length})`)}
          {tabBtn("ho_so", `Hồ sơ claim (${claims.length})`)}
          {tabBtn("no", `Hãng còn nợ & đối trừ${conNo > 0 ? ` (${fmtVND(conNo)})` : ""}`)}
        </div>
      </div>

      {homChot && cho.length > 0 && <div className="card bg-[#FFF6E5] text-sm text-[#A25F00]">⏰ Hôm nay là ngày chốt claim — đang có <b>{cho.length}</b> khoản ({fmtVND(tongCho)}) chờ lập hồ sơ.</div>}

      <div className="flex gap-3 flex-wrap">
        <KPI label="Tiền hãng đang giữ hộ (chờ đối trừ)" value={fmtVND(soDu)} sub="= chưa claim + đang claim + hãng chưa đối trừ" tone="blue" />
        <KPI label="Chưa claim" value={fmtVND(tongCho)} sub={`${cho.length} khoản`} tone={cho.length ? "amber" : "dark"} />
        <KPI label="Chưa claim quá 15 ngày" value={quaHan.length} sub={fmtVND(quaHan.reduce((a, b) => a + b.so_tien, 0))} tone={quaHan.length ? "red" : "dark"} />
        <KPI label="Đã nộp, chờ hãng duyệt" value={choDuyet.length} sub={fmtVND(choDuyet.reduce((a, b) => a + b.tong_tien, 0))} tone="purple" />
        <KPI label="Hãng còn nợ đại lý" value={fmtVND(conNo)} tone={conNo ? "green" : "dark"} />
      </div>

      <div className="card !py-2.5 flex items-center gap-2 flex-wrap text-[13px]">
        <span className="text-[#5A6572]">Ngày chốt claim hằng tháng (1–2 ngày, VD: 5 hoặc 5,20):</span>
        {ngayChot === null ? <b>{ngayChotStr || "chưa đặt"}</b> : <input className="inp !w-28 !py-1" value={ngayChot} onChange={(e) => setNgayChot(e.target.value)} />}
        {(isCeo || profile.role === "ADMIN") && (ngayChot === null
          ? <button className="btn-ghost !text-xs" onClick={() => setNgayChot(ngayChotStr)}>✎ Sửa</button>
          : <>
              <button className="btn-ok !text-xs" disabled={busy} onClick={async () => {
                const v = ngayChot.replace(/\s/g, "");
                if (!/^\d{1,2}(,\d{1,2})?$/.test(v)) return notify("Nhập 1 hoặc 2 ngày trong tháng, VD: 5 hoặc 5,20.", "err");
                const ok = await act("fn_set_setting", { p_key: "claim_ngay_chot", p_value: v }, "Đã lưu ngày chốt claim.");
                if (ok) { setNgayChot(null); refresh && refresh(); }
              }}>Lưu</button>
              <button className="btn-ghost !text-xs" onClick={() => setNgayChot(null)}>Hủy</button>
            </>)}
        <span className="text-[11px] text-[#8A93A0]">Đến ngày chốt, hệ thống nhắc trên Discord (kênh Tài chính) lúc 8h.</span>
      </div>

      {tab === "cho" && (
        <div className="card">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="font-extrabold mr-auto">Các khoản khách trả thẳng cho hãng, chưa claim ({cho.length})</div>
            <span className="text-[13px]">Đã chọn: <b>{selIds.length}</b> · {fmtVND(selTong)}</span>
            <button className="btn-ghost !text-xs" onClick={() => setPick(Object.fromEntries(cho.map((x) => [x.payment_id, true])))}>Chọn tất cả</button>
            <button className="btn-ghost !text-xs" onClick={() => setPick({})}>Bỏ chọn</button>
            {can && <button className="btn-primary !text-xs" disabled={busy || selIds.length === 0} onClick={lap}>Lập hồ sơ claim</button>}
          </div>
          <div className="tbl-scroll"><table className="w-full border-collapse">
            <thead><tr><th className="th w-8"></th><th className="th">Ngày nhận</th><th className="th">Đơn</th><th className="th">Khách</th><th className="th">Số khung</th><th className="th text-right">Số tiền</th><th className="th text-right">Đã</th></tr></thead>
            <tbody>
              {cho.map((x) => (
                <tr key={x.payment_id} className={`hover:bg-[#F8FAFC] ${pick[x.payment_id] ? "bg-[#EAF2FF]" : ""}`}>
                  <td className="td"><input type="checkbox" checked={!!pick[x.payment_id]} onChange={(e) => setPick((p) => ({ ...p, [x.payment_id]: e.target.checked }))} /></td>
                  <td className="td text-xs whitespace-nowrap">{fmtDate(x.ngay)}</td>
                  <td className="td font-semibold text-[13px]">{x.sale_code}</td>
                  <td className="td text-[13px]">{x.customer_name}</td>
                  <td className="td font-mono text-[12px]">{x.frame_number}</td>
                  <td className="td text-right font-bold">{fmtVND(x.so_tien)}</td>
                  <td className="td text-right"><Badge tone={x.so_ngay > 30 ? "red" : x.so_ngay > 15 ? "amber" : "gray"}>{x.so_ngay} ngày</Badge></td>
                </tr>
              ))}
              {cho.length === 0 && <tr><td className="td" colSpan={7}>Không có khoản nào chờ claim.</td></tr>}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === "ho_so" && (
        <div className="flex flex-col gap-2">
          {claims.map((c) => {
            const st = ST[c.status] || { label: c.status, tone: "dark" };
            const ls = dongs.filter((d) => d.claim_id === c.id);
            return (
              <div key={c.id} className="card !p-0 overflow-hidden">
                <button className="w-full text-left p-3 flex items-center gap-2 flex-wrap hover:bg-[#F8FAFC]" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <div className="mr-auto">
                    <div className="font-semibold text-sm">{c.code} {c.ky_claim ? `· ${c.ky_claim}` : ""} {c.so_ho_so && c.so_ho_so !== c.code ? `· hồ sơ hãng ${c.so_ho_so}` : ""}</div>
                    <div className="text-[11px] text-[#8A93A0]">{c.so_khoan} khoản · {c.tu_ngay ? fmtDate(c.tu_ngay) : ""} – {c.den_ngay ? fmtDate(c.den_ngay) : ""} · {c.created_by_name}{c.ngay_nop ? ` · nộp ${fmtDate(c.ngay_nop)}` : ""}{c.ngay_duyet ? ` · duyệt ${fmtDate(c.ngay_duyet)}` : ""}</div>
                  </div>
                  <div className="text-[12px] text-right"><div>Claim <b>{fmtVND(c.tong_tien)}</b></div>{["HANG_DUYET", "DA_DOI_TRU"].includes(c.status) && <div>Duyệt <b className="text-[#0E7A4A]">{fmtVND(c.tien_duyet)}</b></div>}</div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </button>
                {open === c.id && (
                  <div className="border-t border-[#E3E8EF] p-3 bg-[#FBFCFE] flex flex-col gap-2">
                    <div className="tbl-scroll"><table className="w-full border-collapse">
                      <thead><tr><th className="th">Đơn</th><th className="th">Khách</th><th className="th">Số khung</th><th className="th text-right">Số tiền</th><th className="th">Kết quả</th></tr></thead>
                      <tbody>{ls.map((d) => (
                        <tr key={d.id}>
                          <td className="td text-[13px]">{d.sale_code}</td><td className="td text-[13px]">{d.customer_name}</td>
                          <td className="td font-mono text-[12px]">{d.frame_number}</td><td className="td text-right font-bold">{fmtVND(d.so_tien)}</td>
                          <td className="td">
                            {c.status === "DA_NOP" && d.ket_qua === "CHO" && can ? (
                              <div className="flex gap-1.5 flex-wrap items-center">
                                <select className="inp !w-auto !py-1 !text-xs" value={kq[d.id]?.ket_qua || ""} onChange={(e) => setKq((p) => ({ ...p, [d.id]: { ...p[d.id], ket_qua: e.target.value } }))}>
                                  <option value="">— Kết quả —</option>{Object.entries(KQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                                {kq[d.id]?.ket_qua && kq[d.id].ket_qua !== "DUYET" && <input className="inp !py-1 !text-xs min-w-[160px]" placeholder="Lý do (hóa đơn sai, thiếu chứng từ…)" value={kq[d.id]?.ly_do || ""} onChange={(e) => setKq((p) => ({ ...p, [d.id]: { ...p[d.id], ly_do: e.target.value } }))} />}
                              </div>
                            ) : <span className="text-[12.5px]"><Badge tone={d.ket_qua === "DUYET" ? "green" : d.ket_qua === "CHO" ? "amber" : "red"}>{KQ[d.ket_qua] || "Chờ hãng"}</Badge>{d.ly_do ? ` ${d.ly_do}` : ""}</span>}
                          </td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                    {can && c.status === "NHAP" && (
                      <div className="flex gap-2 flex-wrap items-end">
                        <div><label className="lbl">Mã hồ sơ của hãng (nếu có)</label><input className="inp !py-1.5" value={nopF.so_ho_so} onChange={(e) => setNopF((p) => ({ ...p, so_ho_so: e.target.value }))} /></div>
                        <div><label className="lbl">Ngày nộp</label><input type="date" className="inp !py-1.5" max={hom_nay} value={nopF.ngay_nop || hom_nay} onChange={(e) => setNopF((p) => ({ ...p, ngay_nop: e.target.value }))} /></div>
                        <button className="btn-primary !text-xs" disabled={busy} onClick={() => act("fn_claim_nop", { p: { id: c.id, so_ho_so: nopF.so_ho_so, ngay_nop: nopF.ngay_nop || hom_nay } }, "Đã đánh dấu nộp hãng.")}>Đã nộp hồ sơ cho hãng</button>
                        <button className="btn-ghost !text-xs !text-danger" disabled={busy} onClick={() => confirm("Hủy hồ sơ nháp này? Các khoản sẽ về lại danh sách chờ claim.") && act("fn_claim_huy", { p_id: c.id }, "Đã hủy hồ sơ.")}>Hủy hồ sơ</button>
                      </div>
                    )}
                    {can && c.status === "DA_NOP" && (
                      <div className="flex gap-2 flex-wrap items-center">
                        <button className="btn-ok !text-xs" disabled={busy} onClick={() => {
                          const lines = ls.filter((d) => d.ket_qua === "CHO").map((d) => ({ id: d.id, ket_qua: kq[d.id]?.ket_qua, ly_do: kq[d.id]?.ly_do || "" }));
                          if (lines.some((l) => !l.ket_qua)) return notify("Chọn kết quả cho tất cả các khoản.", "err");
                          act("fn_claim_duyet", { p: { id: c.id, lines } }, "Đã ghi kết quả hãng duyệt.");
                        }}>Ghi kết quả hãng duyệt</button>
                        <button className="btn-ghost !text-xs !text-danger" disabled={busy} onClick={() => confirm("Hủy hồ sơ này? Các khoản về lại danh sách chờ claim.") && act("fn_claim_huy", { p_id: c.id }, "Đã hủy hồ sơ.")}>Hủy hồ sơ</button>
                        <span className="text-[11px] text-[#8A93A0]">"Từ chối — bổ sung" đưa khoản về danh sách chờ để nộp lại; "Từ chối hẳn" ghi giảm số tiền hãng giữ hộ.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {claims.length === 0 && <div className="card text-sm text-[#8A93A0]">Chưa có hồ sơ claim nào.</div>}
        </div>
      )}

      {tab === "no" && (
        <>
          <div className="card">
            <div className="font-extrabold mb-1">Hãng còn nợ đại lý (claim đã duyệt)</div>
            <p className="text-[12px] text-[#5A6572] mb-3">Chọn đối trừ vào hóa đơn nhập lô xe tiếp theo hoặc công nợ / đơn nhập phụ tùng. Mỗi lần đối trừ làm giảm số tiền hãng đang giữ hộ và (nếu chọn khoản công nợ NCC) giảm số còn nợ của khoản đó.</p>
            <div className="flex flex-col gap-2">
              {congNo.map((n) => {
                const c = claimOf(n.claim_id); const con = n.so_tien - n.da_doi_tru;
                return (
                  <div key={n.id} className="p-2.5 rounded-xl border border-[#E3E8EF] flex items-center gap-2 flex-wrap text-[13px]">
                    <b>{c?.code}</b><span className="text-[#5A6572]">{c?.ky_claim}</span>
                    <span className="mr-auto text-[#5A6572]">duyệt {fmtVND(n.so_tien)} · đã đối trừ {fmtVND(n.da_doi_tru)}</span>
                    <b className={con > 0 ? "text-[#0E7A4A]" : "text-[#8A93A0]"}>Còn {fmtVND(con)}</b>
                    <Badge tone={n.status === "DA_DOI_TRU" ? "green" : "amber"}>{n.status === "DA_DOI_TRU" ? "Đã đối trừ hết" : "Còn nợ"}</Badge>
                    {can && con > 0 && <button className="btn-primary !px-2.5 !py-1 !text-xs" onClick={() => setDt({ cong_no_id: n.id, loai: "NHAP_XE", so_tien: con, ref_text: "", debt_id: "", ngay: hom_nay, ghi_chu: "", max: con })}>Đối trừ</button>}
                  </div>
                );
              })}
              {congNo.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có khoản nào hãng duyệt.</div>}
            </div>
          </div>

          {dt && (
            <div className="card border-2 border-brand">
              <div className="font-extrabold mb-2">Đối trừ công nợ hãng</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div><label className="lbl">Đối trừ vào</label>
                  <select className="inp" value={dt.loai} onChange={(e) => setDt((p) => ({ ...p, loai: e.target.value }))}>{Object.entries(LOAI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div><label className="lbl">Số tiền đối trừ (tối đa {fmtVND(dt.max)})</label><MoneyInput value={dt.so_tien} onChange={(v) => setDt((p) => ({ ...p, so_tien: v || 0 }))} /></div>
                <div><label className="lbl">Số hóa đơn / đơn nhập được đối trừ</label><input className="inp" value={dt.ref_text} onChange={(e) => setDt((p) => ({ ...p, ref_text: e.target.value }))} placeholder="VD: HĐ 0012345 nhập lô 15/10" /></div>
                <div><label className="lbl">Gắn với khoản công nợ NCC (nếu đã có trong mục Công nợ phải trả)</label>
                  <select className="inp" value={dt.debt_id} onChange={(e) => setDt((p) => ({ ...p, debt_id: e.target.value }))}>
                    <option value="">— Không gắn —</option>{debts.map((d) => <option key={d.id} value={d.id}>{d.supplier} · {d.import_doc} · còn {fmtVND(d.con_no)}</option>)}</select></div>
                <div><label className="lbl">Ngày đối trừ</label><input type="date" className="inp" value={dt.ngay} onChange={(e) => setDt((p) => ({ ...p, ngay: e.target.value }))} /></div>
                <div><label className="lbl">Ghi chú</label><input className="inp" value={dt.ghi_chu} onChange={(e) => setDt((p) => ({ ...p, ghi_chu: e.target.value }))} /></div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-ok" disabled={busy} onClick={async () => {
                  const ok = await act("fn_claim_doi_tru", { p: { cong_no_id: dt.cong_no_id, loai: dt.loai, so_tien: Number(dt.so_tien) || 0, ref_text: dt.ref_text, debt_id: dt.debt_id || "", ngay: dt.ngay, ghi_chu: dt.ghi_chu } }, "Đã ghi đối trừ.");
                  if (ok) setDt(null);
                }}>Xác nhận đối trừ</button>
                <button className="btn-ghost" onClick={() => setDt(null)}>Hủy</button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="font-extrabold mb-2">Lịch sử đối trừ ({doiTru.length})</div>
            <div className="flex flex-col gap-1.5">
              {doiTru.map((x) => {
                const n = congNo.find((y) => y.id === x.cong_no_id); const c = n && claimOf(n.claim_id);
                return (
                  <div key={x.id} className="flex items-center gap-2 text-[13px] py-1 border-b border-dashed border-[#E3E8EF] flex-wrap">
                    <span className="text-xs text-[#8A93A0]">{fmtDate(x.ngay)}</span><b>{c?.code}</b>
                    <span className="mr-auto text-[#5A6572]">{LOAI[x.loai]} {x.ref_text ? `· ${x.ref_text}` : ""} {x.ghi_chu ? `· ${x.ghi_chu}` : ""} · {x.created_by_name}</span>
                    <b>{fmtVND(x.so_tien)}</b>
                  </div>
                );
              })}
              {doiTru.length === 0 && <div className="text-sm text-[#8A93A0]">Chưa có lần đối trừ nào.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
