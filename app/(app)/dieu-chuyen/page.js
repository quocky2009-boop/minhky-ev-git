"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, LocSearch, FrameSearch, Pager, pageSlice, useSortable, Th, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtTime, fmtDate, errMsg, downloadCSV } from "@/lib/format";
import Link from "next/link";

function DieuChuyenInner() {
  const params = useSearchParams();
  const { supabase, vehicles, locations, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();

  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ketQua, setKetQua] = useState(null);
  const [meta, setMeta] = useState({ from: "", to: "", note: "" });
  const [rows, setRows] = useState([]);
  const [tonKho, setTonKho] = useState([]);
  // Filter + bảng lịch sử
  const [fStatus, setFStatus] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const sel = useSelection();

  const load = async () => {
    const { data } = await supabase.from("transfer_orders").select("*").order("requested_at", { ascending: false }).limit(100);
    setList(data || []);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!meta.from) { setTonKho([]); return; }
    (async () => {
      const { data } = await supabase.from("vehicle_units").select("frame_number,vehicle_id")
        .eq("location_code", meta.from).eq("status", "TON_KHO").order("vehicle_id").limit(500);
      setTonKho(data || []);
    })();
  }, [meta.from]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;

  // Filter + sort danh sach phieu
  const kw = q.trim().toLowerCase();
  const filtered = list.filter((t) => {
    if (fStatus && t.status !== fStatus) return false;
    if (fFrom && t.from_location !== fFrom) return false;
    if (fTo && t.to_location !== fTo) return false;
    if (!kw) return true;
    return `${t.code} ${vName(t.vehicle_id)} ${t.requested_by_name} ${t.confirmed_by_name || ""} ${t.note || ""}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    code: (t) => t.code, xe: (t) => vName(t.vehicle_id), from: (t) => locName(t.from_location),
    to: (t) => locName(t.to_location), tt: (t) => t.status, nv: (t) => t.requested_by_name,
    ngay: (t) => t.requested_at, nvnhan: (t) => t.confirmed_by_name || "", ngaynhan: (t) => t.confirmed_at || "",
  });

  const themXe = async (sk) => {
    const s = String(sk || "").trim().toUpperCase();
    if (!s) return;
    if (rows.some((r) => r.frame_number === s)) return notify("Xe này đã có trong phiếu.", "err");
    const { data: u } = await supabase.from("vehicle_units").select("*").eq("frame_number", s).maybeSingle();
    if (!u) return notify(`Không tìm thấy số khung ${s}.`, "err");
    if (u.status !== "TON_KHO") {
      return notify(`Xe ${s} đang ${u.status === "GIU_CHO" ? "giữ chỗ (có cọc)" : u.status === "DANG_CHUYEN" ? "đang chuyển" : u.status}, không chuyển được.`, "err");
    }
    if (!meta.from) setMeta((p) => ({ ...p, from: u.location_code }));
    else if (u.location_code !== meta.from) return notify(`Xe ${s} đang ở ${locName(u.location_code)}, không phải kho đi đã chọn.`, "err");
    setRows((p) => [...p, { frame_number: s, vehicle_id: u.vehicle_id, ten: vName(u.vehicle_id) }]);
    notify(`Đã thêm ${vName(u.vehicle_id)} · ${s}`);
  };

  const themCaMa = (vid) => {
    const them = tonKho.filter((u) => u.vehicle_id === vid && !rows.some((r) => r.frame_number === u.frame_number));
    if (them.length === 0) return notify("Không còn xe nào của mã này.", "err");
    setRows((p) => [...p, ...them.map((u) => ({ frame_number: u.frame_number, vehicle_id: u.vehicle_id, ten: vName(u.vehicle_id) }))]);
    notify(`Đã thêm ${them.length} xe mã ${vName(vid)}.`);
  };

  const theoMa = {};
  rows.forEach((r) => { theoMa[r.vehicle_id] = (theoMa[r.vehicle_id] || 0) + 1; });
  const maTonKho = {};
  tonKho.forEach((u) => { maTonKho[u.vehicle_id] = (maTonKho[u.vehicle_id] || 0) + 1; });

  const luuPhieu = async () => {
    if (!meta.from || !meta.to) return notify("Chọn kho đi và kho đến.", "err");
    if (meta.from === meta.to) return notify("Kho đi và kho đến không được trùng.", "err");
    if (rows.length === 0) return notify("Chưa chọn xe nào.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_tao_dieu_chuyen_v2", { p: {
      from_location: meta.from, to_location: meta.to, note: meta.note,
      frames: rows.map((r) => r.frame_number),
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setKetQua(data);
    notify(`Đã tạo phiếu ${data.code} — ${data.so_xe} xe.`);
    refresh(); load();
  };

  const nhanXe = async (t) => {
    if (!confirm(`Xác nhận đã nhận đủ ${t.quantity} xe ${vName(t.vehicle_id)} tại ${locName(t.to_location)}?`)) return;
    const { error } = await supabase.rpc("fn_xac_nhan_dieu_chuyen", { p_id: t.id });
    if (error) return notify(errMsg(error), "err");
    notify("Đã xác nhận nhận xe — tồn kho đã cập nhật."); refresh(); load();
  };

  const lamMoi = () => { setKetQua(null); setRows([]); setMeta((p) => ({ ...p, note: "" })); };

  if (ketQua) {
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">🔄</div>
          <div className="font-extrabold text-xl mb-1">Đã tạo phiếu điều chuyển</div>
          <div className="text-[13px] text-[#5A6572]"><b>{ketQua.code}</b> · {ketQua.so_xe} xe ({ketQua.so_ma} mã)</div>
          <div className="text-[13px] text-[#5A6572] mt-0.5">{locName(meta.from)} → {locName(meta.to)}</div>
          <div className="text-[12px] text-[#A25F00] mt-2">⏳ Xe đang "Đang chuyển" — tồn kho đổi khi bên nhận xác nhận.</div>
          <div className="flex gap-2 justify-center flex-wrap mt-4">
            <button className="btn-ok" onClick={lamMoi}>+ Tạo phiếu khác</button>
            <Link href="/tra-cuu" className="btn-ghost">Tra cứu tồn</Link>
          </div>
        </div>
      </div>
    );
  }

  const canTao = ["CEO", "MANAGER", "ADMIN", "SALES"].includes(profile.role);

  return (
    <div className="flex flex-col gap-4 pb-24">
      <Toast toast={toast} />
      <div className="font-extrabold text-lg">Điều chuyển kho</div>

      {canTao && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="font-extrabold mb-2.5">Tuyến điều chuyển</div>
              <div className="grid gap-2.5 md:grid-cols-2">
                <Field label="📤 Kho đi" required>
                  <LocSearch locations={locations} value={meta.from}
                    onChange={(v) => { setMeta((p) => ({ ...p, from: v })); if (rows.length) { setRows([]); notify("Đã xóa danh sách xe do đổi kho đi."); } }}
                    placeholder="Chọn kho xuất xe" />
                  {meta.from && <div className="text-[11px] text-[#8A93A0] mt-1">{tonKho.length} xe đang tồn tại kho này</div>}
                </Field>
                <Field label="📥 Kho đến" required>
                  <LocSearch locations={locations.filter((l) => l.code !== meta.from)} value={meta.to}
                    onChange={(v) => setMeta((p) => ({ ...p, to: v }))} placeholder="Chọn kho nhận xe" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Ghi chú">
                    <input className="inp" value={meta.note} onChange={(e) => setMeta((p) => ({ ...p, note: e.target.value }))}
                      placeholder="VD: chuyển xe trưng bày sang cửa hàng 327" />
                  </Field>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="font-extrabold mb-2.5">Thông tin phiếu</div>
              <div className="flex flex-col gap-2.5">
                <Field label="Người tạo"><input className="inp bg-[#F8FAFC]" value={profile.name} disabled /></Field>
                <div className="text-[12px] text-[#5A6572] p-2.5 rounded-xl bg-[#F8FAFC]">
                  Xe chọn xong chuyển trạng thái <b>Đang chuyển</b>. Tồn kho chỉ đổi khi <b>bên nhận xác nhận</b>.
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <div className="font-extrabold mr-auto">Xe cần chuyển</div>
              <span className="text-[11px] text-[#8A93A0]">{rows.length} xe · {Object.keys(theoMa).length} mã</span>
            </div>
            {!meta.from ? (
              <div className="text-sm text-[#8A93A0] py-4 text-center">Chọn kho đi trước để thêm xe.</div>
            ) : (
              <>
                <div className="mb-3">
                  <FrameSearch supabase={supabase} value="" onlyStatus={["TON_KHO"]}
                    placeholder="Tìm số khung để thêm, hoặc quét mã…"
                    onPick={(sk, u) => { if (u) themXe(sk); }} />
                </div>
                {Object.keys(maTonKho).length > 0 && rows.length === 0 && (
                  <div className="mb-3">
                    <div className="text-[11px] text-[#8A93A0] mb-1.5">Hoặc thêm nhanh cả mã xe:</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.entries(maTonKho).map(([vid, n]) => (
                        <button key={vid} className="btn-ghost !px-2.5 !py-1.5 !text-xs" onClick={() => themCaMa(vid)}>
                          {vName(vid)} <span className="text-[#8A93A0]">({n})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
                  <thead><tr><th className="th w-8">STT</th><th className="th">Xe</th><th className="th">Số khung</th><th className="th w-8"></th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.frame_number} className="hover:bg-[#F8FAFC]">
                        <td data-label="STT" className="td text-center text-xs text-[#8A93A0]">{i + 1}</td>
                        <td data-label="Xe" className="td font-semibold text-[13px]">{r.ten}</td>
                        <td data-label="Số khung" className="td font-mono text-[12px] font-bold">{r.frame_number}</td>
                        <td className="td"><button className="text-danger font-bold px-1" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td className="td text-center text-[#8A93A0] py-5" colSpan={4}>Chưa chọn xe nào — tìm số khung hoặc quét mã ở trên.</td></tr>}
                  </tbody>
                </table></div>
                {rows.length > 0 && <button className="text-[11px] text-danger underline mt-2" onClick={() => setRows([])}>Xóa hết danh sách</button>}
              </>
            )}
          </div>

          {rows.length > 0 && (
            <div className="card">
              <div className="font-extrabold mb-2.5">Tổng kết phiếu</div>
              <div className="rounded-xl border border-[#E3E8EF] overflow-hidden">
                {Object.entries(theoMa).map(([vid, n]) => (
                  <div key={vid} className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                    <span className="text-[#5A6572]">{vName(vid)}</span><span className="font-bold">{n} xe</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2.5 bg-[#EAF2FF]">
                  <span className="font-bold text-[13.5px]">{locName(meta.from)} → {locName(meta.to) || "…"}</span>
                  <span className="text-[18px] font-extrabold text-brand">{rows.length} xe</span>
                </div>
              </div>
            </div>
          )}

          <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-3 z-30">
            <div className="text-[13px] hidden sm:block">
              {meta.from && meta.to
                ? <><span className="text-[#8A93A0]">Chuyển:</span> <b>{locName(meta.from)} → {locName(meta.to)}</b> <span className="text-brand font-bold ml-2">{rows.length} xe</span></>
                : <span className="text-[#8A93A0]">Chọn kho đi và kho đến</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={lamMoi}>Xóa hết</button>
              <button className="btn-ok !px-6" disabled={busy || rows.length === 0 || !meta.to} onClick={luuPhieu}>
                {busy ? "Đang tạo…" : `Tạo phiếu${rows.length > 0 ? ` (${rows.length} xe)` : ""}`}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="font-extrabold mb-3">Lịch sử phiếu điều chuyển ({list.length})</div>
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <select className="inp !w-auto" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }}>
            <option value="">Trạng thái: tất cả</option>
            <option>Đang chuyển</option><option>Đã nhận</option><option>Đã hủy</option><option>Lỗi/chênh lệch</option>
          </select>
          <div className="!w-44"><LocSearch locations={locations} value={fFrom} onChange={(v) => { setFFrom(v); setPage(1); }} placeholder="Kho xuất…" /></div>
          <div className="!w-44"><LocSearch locations={locations} value={fTo} onChange={(v) => { setFTo(v); setPage(1); }} placeholder="Kho nhận…" /></div>
          <input className="inp !w-52" placeholder="Tìm mã phiếu, xe, người lập…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <button className="btn-ghost !text-xs ml-auto" onClick={() => {
            const rs = sorted.filter((t) => sel.has(t.id));
            const exp = rs.length ? rs : sorted;
            downloadCSV(`dieu_chuyen.csv`, [["Mã phiếu","Xe","SL","Kho xuất","Kho nhận","Trạng thái","Ngày lập","Người lập","Ngày nhận","Người nhận","Ghi chú"],
              ...exp.map((t) => [t.code, vName(t.vehicle_id), t.quantity, locName(t.from_location), locName(t.to_location), t.status, fmtTime(t.requested_at), t.requested_by_name, t.confirmed_at ? fmtTime(t.confirmed_at) : "", t.confirmed_by_name || "", t.note || ""])]);
            notify(`Đã xuất ${exp.length} phiếu.`);
          }}>⬇ Xuất Excel</button>
        </div>
        <SelectionBar sel={sel}>
          <span className="text-[12px] font-bold text-brand px-1 self-center">{sel.count} phiếu</span>
          <button className="btn-ghost !text-xs !py-1" onClick={() => {
            const rs = sorted.filter((t) => sel.has(t.id));
            downloadCSV(`dieu_chuyen_chon.csv`, [["Mã phiếu","Xe","SL","Kho xuất","Kho nhận","Trạng thái","Ngày lập","Người lập","Ngày nhận","Người nhận"],
              ...rs.map((t) => [t.code, vName(t.vehicle_id), t.quantity, locName(t.from_location), locName(t.to_location), t.status, fmtTime(t.requested_at), t.requested_by_name, t.confirmed_at ? fmtTime(t.confirmed_at) : "", t.confirmed_by_name || ""])]);
            notify(`Đã xuất ${rs.length} phiếu.`);
          }}>⬇ Xuất Excel</button>
        </SelectionBar>
        <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
          <thead><tr>
            <ThCheck sel={sel} rows={pageSlice(sorted, page, pageSize)} idOf={(t) => t.id} />
            <Th label="Mã phiếu" k="code" sort={sort} />
            <Th label="Xe · SL" k="xe" sort={sort} />
            <Th label="Kho xuất → Kho nhận" k="from" sort={sort} />
            <Th label="Trạng thái" k="tt" sort={sort} />
            <Th label="Người lập · Ngày lập" k="ngay" sort={sort} />
            <Th label="Người nhận · Ngày nhận" k="ngaynhan" sort={sort} />
            <th className="th">Ghi chú / SK</th>
            <th className="th"></th>
          </tr></thead>
          <tbody>{pageSlice(sorted, page, pageSize).map((t) => (
            <tr key={t.id} className={`${sel.has(t.id) ? "bg-[#EAF2FF]" : t.status === "Đang chuyển" ? "bg-[#FFFCF0] hover:bg-[#FFF8E0]" : "hover:bg-[#F8FAFC]"}`}>
              <TdCheck sel={sel} id={t.id} />
              <td data-label="Mã phiếu" className="td font-bold text-xs"><Link href={`/dieu-chuyen/${t.id}`} className="text-brand hover:underline">{t.code}</Link></td>
              <td data-label="Xe" className="td text-[13px]">{vName(t.vehicle_id)}<div className="text-[10.5px] text-[#8A93A0]">{t.quantity} xe</div></td>
              <td data-label="Kho" className="td text-xs">
                <div>{locName(t.from_location)}</div>
                <div className="text-[#8A93A0]">→ {locName(t.to_location)}</div>
              </td>
              <td data-label="Trạng thái" className="td"><Badge tone={t.status === "Đã nhận" ? "green" : t.status === "Đang chuyển" ? "amber" : "dark"}>{t.status}</Badge></td>
              <td data-label="Người lập" className="td text-xs">
                <div>{t.requested_by_name}</div>
                <div className="text-[#8A93A0] whitespace-nowrap">{fmtTime(t.requested_at)}</div>
              </td>
              <td data-label="Người nhận" className="td text-xs">
                {t.confirmed_by_name
                  ? <><div>{t.confirmed_by_name}</div><div className="text-[#8A93A0] whitespace-nowrap">{fmtTime(t.confirmed_at)}</div></>
                  : <span className="text-[#C6CDD6]">—</span>}
              </td>
              <td data-label="Ghi chú" className="td text-xs" style={{ minWidth: "120px", maxWidth: "200px", wordBreak: "break-word" }}>
                {t.note && <div>{t.note}</div>}
                {(t.frames || []).length > 0 && <div className="font-mono text-[10px] text-[#8A93A0]">{t.frames.join(", ")}</div>}
              </td>
              <td className="td">{t.status === "Đang chuyển" && ["CEO","MANAGER","ADMIN"].includes(profile.role) && (
                <button className="btn-ok !px-2 !py-1 !text-xs whitespace-nowrap" onClick={() => nhanXe(t)}>✓ Nhận xe</button>
              )}</td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td className="td" colSpan={9}>Không có phiếu điều chuyển nào.</td></tr>}
          </tbody>
        </table></div>
        <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
      </div>
    </div>
  );
}

export default function DieuChuyen() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><DieuChuyenInner /></Suspense>;
}
