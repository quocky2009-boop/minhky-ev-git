"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCatalog, useToast } from "@/lib/useData";
import { Field, Badge, Toast, KPI, LocSearch, VehicleSearch, MoneyInput, Pager, pageSlice, pageClamp, useSortable, Th, useSelection, ThCheck, TdCheck, SelectionBar } from "@/components/ui";
import { fmtVND, fmtTime, errMsg, downloadCSV } from "@/lib/format";
import Scanner from "@/components/Scanner";

const iso = (d) => d.toLocaleDateString("sv-SE");
const firstOfMonth = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const emptyLine = { vehicle_id: "", frames: [], cost_price: 0, note: "" };

function NhapHangInner() {
  const { supabase, vehicles, locations, settings, profile, loading, refresh } = useCatalog();
  const { toast, notify } = useToast();
  const [perms, setPerms] = useState({});
  useEffect(() => {
    if (!profile) return;
    supabase.from("role_perms").select("perm,allowed").eq("role", profile.role).then(({ data }) => {
      const m = {}; (data || []).forEach((x) => { m[x.perm] = x.allowed; }); setPerms(m);
    });
  }, [profile]);

  // ===== DANH SÁCH =====
  const [txns, setTxns] = useState([]);
  const [trangThaiMap, setTrangThaiMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [suaKhoDoc, setSuaKhoDoc] = useState(null);
  const [suaKhoMoi, setSuaKhoMoi] = useState("");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(iso(new Date()));
  const [fLoc, setFLoc] = useState("");
  const [fSup, setFSup] = useState("");
  const [q, setQ] = useState("");
  const searchParams = useSearchParams();
  useEffect(() => {
    const d = searchParams.get("doc");
    if (d) { setQ(d); setFrom("2000-01-01"); } // no rong khoang ngay de chac chan tim thay lo nhap thang truoc
  }, [searchParams]);
  useEffect(() => {
    const poId = searchParams.get("po_id");
    if (!poId || !profile) return;
    (async () => {
      const [{ data: o }, { data: ln }] = await Promise.all([
        supabase.from("purchase_orders").select("*").eq("id", poId).single(),
        supabase.from("purchase_order_lines").select("*").eq("po_id", poId).order("id"),
      ]);
      if (!o) return;
      setShowForm(true); setKetQua(null);
      setMeta((p) => ({ ...p, location_code: o.location_code, supplier: o.supplier || "", po_id: o.id, po_code: o.code,
        nguoi_nhap_id: p.nguoi_nhap_id || profile.id, nguoi_nhap_name: p.nguoi_nhap_name || profile.name }));
      const conLai = (ln || []).filter((l) => l.qty_ordered > l.qty_received);
      setLines(conLai.length > 0 ? conLai.map((l) => ({ vehicle_id: l.vehicle_id, frames: [], cost_price: 0, note: "", con_thieu: l.qty_ordered - l.qty_received })) : [{ ...emptyLine }]);
    })();
  }, [searchParams, profile]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const sort = useSortable();
  const sel = useSelection();
  const [detail, setDetail] = useState(null);

  // ===== FORM =====
  const [showForm, setShowForm] = useState(false);
  const [ketQua, setKetQua] = useState(null);
  const [meta, setMeta] = useState({ location_code: "", supplier: "", doc: "", note: "", ngay: iso(new Date()), nguoi_nhap_id: "", nguoi_nhap_name: "", po_id: "", po_code: "" });
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [scanIdx, setScanIdx] = useState(null);
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    if (!loading) supabase.from("profiles").select("id,name,role").eq("status", "Hoạt động").order("name").then(({ data }) => setStaff(data || []));
  }, [loading]);
  useEffect(() => {
    if (profile && !meta.nguoi_nhap_id) setMeta((p) => ({ ...p, nguoi_nhap_id: profile.id, nguoi_nhap_name: profile.name }));
  }, [profile]);

  const load = async () => {
    setBusy(true);
    const toEnd = to + "T23:59:59";
    const { data } = await supabase.from("inventory_txns").select("*")
      .eq("txn_type", "Nhập hàng").gte("created_at", from).lte("created_at", toEnd)
      .order("created_at", { ascending: false }).limit(5000);
    setTxns(data || []);
    setBusy(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading, from, to]);
  useEffect(() => {
    const docs = [...new Set(txns.map((t) => t.doc_code).filter(Boolean))];
    if (docs.length === 0) { setTrangThaiMap({}); return; }
    supabase.rpc("fn_trang_thai_don_nhap", { p_docs: docs }).then(({ data }) => {
      const m = {}; (data || []).forEach((r) => { m[r.doc] = r.trang_thai; });
      setTrangThaiMap(m);
    });
  }, [txns]);

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;
  const canNhap = profile.role === "CEO" || perms["nhap_hang"];

  const xoaHanDon = async (doc) => {
    if (!confirm(`⚠️ XÓA HẲN đơn nhập ${doc} khỏi database?\n\nHành động này KHÔNG THỂ HOÀN TÁC — toàn bộ số khung và lịch sử giao dịch của đơn này sẽ bị xóa vĩnh viễn (khác với "Hủy đơn" chỉ ẩn khỏi tồn kho).\n\nChỉ nên dùng cho đơn TEST/nhập nhầm hoàn toàn — KHÔNG dùng cho đơn thật đã hủy vì lý do nghiệp vụ (đổi hàng, sai giá...), vì sẽ mất luôn dấu vết lịch sử.\n\nBấm OK để tiếp tục.`)) return;
    if (prompt(`Để xác nhận lần cuối, gõ đúng mã phiếu "${doc}" vào đây:`) !== doc) return notify("Gõ không đúng mã phiếu — đã hủy thao tác xóa.", "err");
    const { data, error } = await supabase.rpc("fn_xoa_han_don_nhap_huy", { p_doc: doc });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã xóa hẳn ${data.so_xe_xoa} số khung + ${data.so_dong_log_xoa} dòng lịch sử của đơn ${doc}.`);
    load();
  };

  const luuSuaKho = async (doc) => {
    if (!suaKhoMoi) return notify("Chọn kho mới.", "err");
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_sua_kho_don_nhap", { p_doc: doc, p_location_code: suaKhoMoi });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã chuyển ${data} xe của đơn ${doc} sang kho mới.`);
    setSuaKhoDoc(null); setSuaKhoMoi(""); load();
  };

  const khoiPhucDon = async (doc) => {
    if (!confirm(`Khôi phục đơn nhập ${doc} đã hủy?\n\nToàn bộ xe trong đơn sẽ trở lại Tồn kho như trước khi hủy. Sau khi khôi phục, có thể dùng "✏️ Sửa kho nhập" để đổi kho nếu cần.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("fn_khoi_phuc_don_nhap_huy", { p_doc: doc });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    notify(`Đã khôi phục ${data} xe của đơn ${doc} về Tồn kho.`);
    load();
  };

  const vName = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.brand} ${v.name} ${v.color}` : id; };
  const vShort = (id) => { const v = vehicles.find((x) => x.id === id); return v ? `${v.name} ${v.color}` : id; };
  const locName = (c) => locations.find((l) => l.code === c)?.name || c;
  const sups = (settings?.suppliers || "VinFast\nTAILG").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  // Gom cac dong txn theo doc_code -> 1 "đơn nhập"
  const parseSup = (note) => { const m = /NCC:\s*([^·]+?)(?:\s·|$)/.exec(note || ""); return m ? m[1].trim() : ""; };
  const donMap = {};
  txns.forEach((t) => {
    const k = t.doc_code || `#${t.id}`;
    if (!donMap[k]) donMap[k] = {
      doc: k, created_at: t.created_at, location_code: t.to_location, by: t.created_by_name,
      supplier: parseSup(t.note), so_ma: 0, so_xe: 0, lines: [],
    };
    const d = donMap[k];
    if (new Date(t.created_at) < new Date(d.created_at)) d.created_at = t.created_at;
    d.so_ma += 1; d.so_xe += (t.qty || 0); d.lines.push(t);
  });
  const dons = Object.values(donMap);

  const filtered = dons.filter((d) => {
    if (fLoc && d.location_code !== fLoc) return false;
    if (fSup && d.supplier !== fSup) return false;
    if (!q) return true;
    const kw = q.toLowerCase();
    const xeStr = d.lines.map((l) => vName(l.vehicle_id)).join(" ");
    return `${d.doc} ${d.supplier} ${d.by} ${xeStr}`.toLowerCase().includes(kw);
  });
  const sorted = sort.sortFn(filtered, {
    doc: (d) => d.doc, date: (d) => d.created_at, kho: (d) => locName(d.location_code),
    ncc: (d) => d.supplier, xe: (d) => d.so_xe, nv: (d) => d.by,
  });

  const soDon = dons.length;
  const tongXe = dons.reduce((s, d) => s + d.so_xe, 0);

  const exportCSV = () => {
    downloadCSV(`don_nhap_${iso(new Date())}.csv`,
      [["Mã phiếu", "Ngày", "Kho", "NCC", "Số mã", "Số xe", "Người nhập"],
        ...sorted.map((d) => [d.doc, fmtTime(d.created_at), locName(d.location_code), d.supplier, d.so_ma, d.so_xe, d.by])]);
    notify(`Đã xuất ${sorted.length} phiếu nhập.`);
  };

  // ========================= FORM NHẬP =========================
  const setLine = (i, k, v) => setLines((p) => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const themSK = (i, raw) => {
    const list = String(raw || "").split(/[\s,;\n]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0) return;
    setLines((p) => p.map((x, j) => {
      if (j !== i) return x;
      const moi = list.filter((sk) => !x.frames.includes(sk));
      const trung = list.filter((sk) => x.frames.includes(sk));
      if (trung.length) notify(`Bỏ qua ${trung.length} số khung đã có trong dòng.`, "err");
      return { ...x, frames: [...x.frames, ...moi] };
    }));
  };
  const tongXeForm = lines.reduce((s, l) => s + l.frames.length, 0);
  const tongVon = lines.reduce((s, l) => s + l.frames.length * (Number(l.cost_price) || 0), 0);
  const soMaForm = lines.filter((l) => l.vehicle_id && l.frames.length > 0).length;

  const moForm = () => {
    setShowForm(true); setKetQua(null); setLines([{ ...emptyLine }]);
    setMeta({ location_code: "", supplier: "", doc: "", note: "", ngay: iso(new Date()), nguoi_nhap_id: profile?.id || "", nguoi_nhap_name: profile?.name || "", po_id: "", po_code: "" });
  };
  const dongForm = () => { setShowForm(false); setKetQua(null); load(); };

  const luuPhieu = async () => {
    if (!meta.location_code) return notify("Chọn kho nhập.", "err");
    const ok = lines.filter((l) => l.vehicle_id && l.frames.length > 0);
    if (ok.length === 0) return notify("Chưa có dòng hàng hợp lệ (cần chọn mã xe và nhập số khung).", "err");

    // CANH BAO 1: dong dien do do (co mot trong hai: ma xe HOAC so khung, nhung khong ca hai)
    // se bi AM THAM bo qua khi luu — nhac truoc de tranh mat du lieu ngoai y muon.
    const boQua = lines.filter((l) => (l.vehicle_id && l.frames.length === 0) || (!l.vehicle_id && l.frames.length > 0));
    if (boQua.length > 0) {
      const chiTiet = boQua.map((l) => l.vehicle_id ? `"${vName(l.vehicle_id)}" (chưa nhập số khung)` : `${l.frames.length} số khung chưa chọn mã xe`).join("\n- ");
      if (!confirm(`⚠️ Có ${boQua.length} dòng ĐIỀN DỞ sẽ KHÔNG được lưu (thiếu mã xe hoặc thiếu số khung):\n- ${chiTiet}\n\nBấm OK nếu chắc chắn bỏ qua các dòng này. Bấm Hủy để quay lại điền đủ.`)) return;
    }

    // CANH BAO 2: 1 dong co so luong xe lon bat thuong — de phong dan nham toan bo
    // so khung cua nhieu model vao chung 1 o (nguyen nhan da gap trong thuc te).
    const dongNhieu = ok.filter((l) => l.frames.length > 15);
    if (dongNhieu.length > 0) {
      const chiTiet = dongNhieu.map((l) => `"${vName(l.vehicle_id)}": ${l.frames.length} xe`).join("\n- ");
      if (!confirm(`⚠️ Có dòng số lượng xe LỚN BẤT THƯỜNG trong 1 lần nhập:\n- ${chiTiet}\n\nKIỂM TRA LẠI: có phải đã lỡ dán nhầm số khung của NHIỀU MODEL/MÀU khác nhau vào chung 1 dòng này không?\n\nBấm OK nếu chắc chắn đúng cả ${dongNhieu.reduce((s,l)=>s+l.frames.length,0)} xe này CÙNG 1 model/màu. Bấm Hủy để kiểm tra lại.`)) return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("fn_nhap_hang_v2", { p: {
      location_code: meta.location_code, supplier: meta.supplier, doc: meta.doc, note: meta.note,
      lines: ok.map((l) => ({ vehicle_id: l.vehicle_id, frames: l.frames, cost_price: Number(l.cost_price) || 0, note: l.note })),
      nguoi_nhap_id: meta.nguoi_nhap_id,
      po_id: meta.po_id || null,
    } });
    setBusy(false);
    if (error) return notify(errMsg(error), "err");
    setKetQua(data);
    notify(`Đã nhập ${data.so_xe} xe vào kho.`);
    refresh();
  };

  const lamMoi = () => {
    setKetQua(null); setLines([{ ...emptyLine }]);
    setMeta((p) => ({ ...p, supplier: "", doc: "", note: "" }));
  };

  const openDetail = async (d) => {
    const { data: u } = await supabase.from("vehicle_units").select("*").eq("import_doc", d.doc).limit(500);
    setDetail({ ...d, units: u || [] });
  };

  // ===== SAU KHI LƯU PHIẾU =====
  if (showForm && ketQua) {
    return (
      <div className="flex flex-col gap-4">
        <Toast toast={toast} />
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">📦</div>
          <div className="font-extrabold text-xl mb-1">Đã nhập {ketQua.so_xe} xe vào kho</div>
          <div className="text-[13px] text-[#5A6572]">Phiếu <b>{ketQua.doc}</b> · {ketQua.so_ma} mã xe · kho {locName(meta.location_code)}</div>
          {ketQua.tong_von > 0 && <div className="text-[13px] text-[#5A6572] mt-0.5">Tổng giá vốn: <b>{fmtVND(ketQua.tong_von)}</b></div>}
          <div className="flex gap-2 justify-center flex-wrap mt-4">
            <button className="btn-ok" onClick={lamMoi}>+ Nhập phiếu khác</button>
            <button className="btn-ghost" onClick={dongForm}>← Về danh sách đơn nhập</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== FORM NHẬP HÀNG =====
  if (showForm) {
    return (
      <div className="flex flex-col gap-4 pb-24">
        <Toast toast={toast} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-ghost !text-xs" onClick={dongForm}>← Danh sách đơn nhập</button>
          <div className="font-extrabold text-lg mr-auto">
            {meta.po_id ? `Nhập hàng từ đơn đặt: ${meta.po_code}` : "Tạo đơn nhập mới"}
          </div>
        </div>

        {/* HÀNG 1: NCC | THÔNG TIN PHIẾU */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <div className="font-extrabold mb-2.5">Thông tin nhà cung cấp</div>
            <div className="grid gap-2.5 md:grid-cols-2">
              <Field label="Nhà cung cấp">
                <select className="inp" value={meta.supplier} onChange={(e) => setMeta((p) => ({ ...p, supplier: e.target.value }))}>
                  <option value="">— Chọn NCC —</option>
                  {sups.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Số chứng từ NCC (nếu có)">
                <input className="inp" value={meta.doc} onChange={(e) => setMeta((p) => ({ ...p, doc: e.target.value.toUpperCase() }))} placeholder="Bỏ trống = tự sinh mã PN-…" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Ghi chú phiếu nhập">
                  <input className="inp" value={meta.note} onChange={(e) => setMeta((p) => ({ ...p, note: e.target.value }))} placeholder="VD: lô hàng tháng 7, xe giao đợt 2" />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-2.5">Thông tin bổ sung</div>
            <div className="flex flex-col gap-2.5">
              <Field label="Nhập vào kho" required>
                <LocSearch locations={locations} value={meta.location_code} onChange={(v) => setMeta((p) => ({ ...p, location_code: v }))} placeholder="Chọn kho / cửa hàng" />
              </Field>
              <Field label="Người nhập">
                <select className="inp" value={meta.nguoi_nhap_id || ""}
                  onChange={(e) => {
                    const found = staff.find((s) => s.id === e.target.value);
                    setMeta((p) => ({ ...p, nguoi_nhap_id: e.target.value, nguoi_nhap_name: found?.name || "" }));
                  }}>
                  <option value="">— Chọn nhân viên —</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                </select>
              </Field>
              <Field label="Ngày nhập"><input type="date" className="inp" value={meta.ngay} onChange={(e) => setMeta((p) => ({ ...p, ngay: e.target.value }))} /></Field>
            </div>
          </div>
        </div>

        {/* HÀNG 2: BẢNG HÀNG HÓA */}
        <div className="card">
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <div className="font-extrabold mr-auto">Thông tin hàng hóa</div>
            <span className="text-[11px] text-[#8A93A0]">{soMaForm} mã · {tongXeForm} xe</span>
          </div>

          <div className="flex flex-col gap-3">
            {lines.map((l, i) => {
              const dienDo = (l.vehicle_id && l.frames.length === 0) || (!l.vehicle_id && l.frames.length > 0);
              const soLuongLon = l.vehicle_id && l.frames.length > 15;
              return (
              <div key={i} className={`rounded-xl border p-3 ${dienDo ? "border-[#F0B429] bg-[#FFFBEB]" : soLuongLon ? "border-danger bg-[#FFF6F6]" : "border-[#E3E8EF]"}`}>
                {soLuongLon && (
                  <div className="text-[11px] text-danger font-bold mb-1.5">⚠️ {l.frames.length} xe trong 1 dòng — số lượng lớn bất thường, kiểm tra kỹ có bị dán nhầm số khung của model/màu khác vào đây không.</div>
                )}
                <div className="grid gap-2.5 md:grid-cols-4 mb-2.5">
                  <div className="md:col-span-2">
                    <label className="lbl">Mã xe {i + 1}</label>
                    <VehicleSearch vehicles={vehicles} value={l.vehicle_id} onChange={(id) => setLine(i, "vehicle_id", id || "")} />
                    {l.con_thieu > 0 && <div className="text-[11px] text-[#A25F00] mt-1">Đơn đặt còn thiếu {l.con_thieu} xe</div>}
                  </div>
                  <div>
                    <label className="lbl">💰 Giá vốn / xe</label>
                    <MoneyInput value={l.cost_price} onChange={(v) => setLine(i, "cost_price", v)} placeholder="Giá nhập thực tế" />
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="lbl">Số lượng</label>
                      <div className="inp bg-[#F8FAFC] flex items-center font-bold">{l.frames.length} xe</div>
                    </div>
                    {lines.length > 1 && (
                      <button className="btn-ghost !px-2.5 !py-2 !text-danger" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </div>
                </div>

                <label className="lbl">Số khung (dán nhiều dòng, cách nhau bằng dấu phẩy hoặc xuống dòng)</label>
                <div className="flex gap-1.5 mb-2">
                  <input className="inp font-mono !text-[13px]" placeholder="Nhập/dán số khung rồi Enter…"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); themSK(i, e.target.value); e.target.value = ""; } }}
                    onBlur={(e) => { if (e.target.value.trim()) { themSK(i, e.target.value); e.target.value = ""; } }} />
                  <button className="btn-ghost !px-3 whitespace-nowrap" onClick={() => setScanIdx(i)}>📷 Quét</button>
                </div>

                {l.frames.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {l.frames.map((sk, k) => (
                      <span key={sk} className="inline-flex items-center gap-1.5 bg-[#F3F5F8] rounded-lg px-2 py-1 text-[11.5px] font-mono">
                        {sk}
                        <button className="text-danger font-bold" onClick={() => setLine(i, "frames", l.frames.filter((_, j) => j !== k))}>✕</button>
                      </span>
                    ))}
                    <button className="text-[11px] text-danger underline" onClick={() => setLine(i, "frames", [])}>Xóa hết</button>
                  </div>
                )}

                {l.vehicle_id && l.frames.length > 0 && (Number(l.cost_price) || 0) > 0 && (
                  <div className="text-[12px] text-[#5A6572] mt-2 text-right">
                    {l.frames.length} × {fmtVND(l.cost_price)} = <b className="text-brand">{fmtVND(l.frames.length * Number(l.cost_price))}</b>
                  </div>
                )}
              </div>
              );
            })}
          </div>

          <button className="btn-ghost !text-xs mt-2.5" onClick={() => setLines((p) => [...p, { ...emptyLine }])}>⊕ Thêm mã xe khác</button>
        </div>

        {/* HÀNG 3: TỔNG KẾT */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="font-extrabold mb-2.5">Kiểm tra trước khi lưu</div>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {lines.filter((l) => l.vehicle_id && l.frames.length > 0).map((l, i) => (
                <div key={i} className="flex justify-between gap-2 py-1 border-b border-dashed border-[#EEF1F4]">
                  <span className="min-w-0"><b>{vName(l.vehicle_id)}</b><span className="block text-[11px] text-[#8A93A0]">{l.frames.length} số khung</span></span>
                  <span className="text-right whitespace-nowrap">{fmtVND(l.frames.length * (Number(l.cost_price) || 0))}</span>
                </div>
              ))}
              {soMaForm === 0 && <div className="text-[#8A93A0]">Chưa có dòng hàng nào hợp lệ.</div>}
            </div>
          </div>

          <div className="card">
            <div className="font-extrabold mb-2.5">Tổng kết phiếu</div>
            <div className="rounded-xl border border-[#E3E8EF] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                <span className="text-[#5A6572]">Số mã xe</span><span className="font-bold">{soMaForm}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                <span className="text-[#5A6572]">Tổng số xe</span><span className="font-bold">{tongXeForm} chiếc</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-[#E3E8EF] text-[13.5px]">
                <span className="text-[#5A6572]">Kho nhập</span><span className="font-bold">{meta.location_code ? locName(meta.location_code) : "—"}</span>
              </div>
              <div className={`flex items-center justify-between px-3 py-2.5 ${tongVon > 0 ? "bg-[#EAF2FF]" : "bg-[#FFF6E5]"}`}>
                <span className="font-bold text-[13.5px]">Tổng giá vốn lô hàng</span>
                <span className={`text-[18px] font-extrabold ${tongVon > 0 ? "text-brand" : "text-[#A25F00]"}`}>{fmtVND(tongVon)}</span>
              </div>
            </div>
            {tongVon === 0 && tongXeForm > 0 && (
              <div className="text-[11.5px] text-[#A25F00] mt-2">⚠ Chưa khai giá vốn — báo cáo lãi gộp sẽ thiếu số liệu.</div>
            )}
          </div>
        </div>

        {/* THANH DÍNH ĐÁY */}
        <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] bg-white border-t border-[#E6EAEF] px-4 py-3 flex items-center gap-3 z-30">
          <div className="text-[13px] hidden sm:block">
            <span className="text-[#8A93A0]">Tổng:</span> <b className="text-brand text-[15px]">{tongXeForm} xe</b>
            {tongVon > 0 && <span className="text-[#5A6572] ml-2">· {fmtVND(tongVon)}</span>}
          </div>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={dongForm}>Hủy</button>
            <button className="btn-ok !px-6" disabled={busy || tongXeForm === 0} onClick={luuPhieu}>
              {busy ? "Đang lưu…" : `Nhập kho${tongXeForm > 0 ? ` (${tongXeForm} xe)` : ""}`}
            </button>
          </div>
        </div>

        {scanIdx !== null && (
          <Scanner onAdd={(code) => { themSK(scanIdx, code); }} onClose={() => setScanIdx(null)} />
        )}
      </div>
    );
  }

  // ========================= DANH SÁCH ĐƠN NHẬP =========================
  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="flex gap-3 flex-wrap">
        <KPI label="Số phiếu nhập" value={soDon} tone="dark" />
        <KPI label="Tổng xe đã nhập" value={tongXe} tone="green" />
      </div>

      <div className="card">
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <div className="font-extrabold mr-auto">Danh sách đơn nhập ({sorted.length})</div>
          {canNhap && <button className="btn-primary !text-xs" onClick={moForm}>+ Tạo đơn nhập mới</button>}
          {!canNhap && <Badge tone="amber">Chỉ Admin/BGĐ được nhập hàng</Badge>}
          <input type="date" className="inp !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="inp !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="!w-52"><LocSearch locations={locations} value={fLoc} onChange={setFLoc} placeholder="Lọc kho…" /></div>
          <select className="inp !w-auto" value={fSup} onChange={(e) => { setFSup(e.target.value); setPage(1); }}>
            <option value="">NCC: tất cả</option>
            {sups.map((x) => <option key={x}>{x}</option>)}
          </select>
          <input className="inp !w-56" placeholder="Tìm mã phiếu, NCC, xe, người nhập…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <button className="btn-ghost !text-xs" onClick={exportCSV}>⬇ CSV</button>
        </div>

        {busy && txns.length === 0 ? <div className="text-sm text-[#8A93A0] py-4">Đang tải đơn nhập…</div> : (
          <>
            <SelectionBar sel={sel}>
              <span className="text-[12px] font-bold text-brand px-1.5 self-center">Tổng xe: {sorted.filter((d) => sel.has(d.doc)).reduce((a, b) => a + b.so_xe, 0)}</span>
              <button className="btn-ghost !text-xs !py-1" onClick={() => {
                const rs = sorted.filter((d) => sel.has(d.doc));
                downloadCSV(`don_nhap_chon.csv`, [["Mã phiếu", "Ngày", "Kho", "NCC", "Số mã", "Số xe", "Người nhập"],
                  ...rs.map((d) => [d.doc, fmtTime(d.created_at), locName(d.location_code), d.supplier, d.so_ma, d.so_xe, d.by])]);
                notify(`Đã xuất ${rs.length} phiếu đã chọn.`);
              }}>⬇ Xuất Excel</button>
              <button className="btn-ghost !text-xs !py-1 !text-danger" disabled={busy} onClick={async () => {
                const rs = sorted.filter((d) => sel.has(d.doc));
                if (rs.length === 0) return;
                if (!confirm(`Hủy ${rs.length} đơn nhập đã chọn?\n\nChỉ hủy được đơn mà TOÀN BỘ xe trong đơn vẫn còn tồn kho (chưa bán/chuyển/điều chỉnh). Không thể hoàn tác.`)) return;
                setBusy(true);
                let ok = 0; const loi = [];
                for (const d of rs) {
                  const { error } = await supabase.rpc("fn_huy_don_nhap", { p_doc: d.doc });
                  if (error) loi.push(`${d.doc}: ${errMsg(error)}`); else ok++;
                }
                setBusy(false);
                sel.clear?.();
                if (ok > 0) notify(`Đã hủy ${ok} đơn nhập.`);
                if (loi.length > 0) notify(`${loi.length} đơn không hủy được:\n${loi.join("\n")}`, "err");
                load();
              }}>✕ Hủy đơn đã chọn</button>
            </SelectionBar>
            <div className="tbl-scroll"><table className="w-full border-collapse tbl-card">
              <thead><tr>
                <ThCheck sel={sel} rows={pageSlice(sorted, page, pageSize)} idOf={(d) => d.doc} />
                <Th label="Mã phiếu" k="doc" sort={sort} />
                <th className="th">Trạng thái</th>
                <Th label="Ngày nhập" k="date" sort={sort} />
                <Th label="Kho" k="kho" sort={sort} />
                <Th label="Nhà cung cấp" k="ncc" sort={sort} />
                <Th label="Xe (mã · chiếc)" k="xe" sort={sort} />
                <Th label="Người nhập" k="nv" sort={sort} />
                <th className="th"></th>
              </tr></thead>
              <tbody>{pageSlice(sorted, page, pageSize).map((d) => { return [
                <tr key={d.doc} className={`hover:bg-[#F8FAFC] ${trangThaiMap[d.doc] === "Đơn hủy" ? "bg-[#F3F4F6] text-[#8A93A0]" : sel.has(d.doc) ? "bg-[#EAF2FF]" : ""}`}>
                  <TdCheck sel={sel} id={d.doc} />
                  <td data-label="Mã phiếu" className="td font-bold"><Link href={`/nhap-hang/${encodeURIComponent(d.doc)}`} className="text-brand hover:underline">{d.doc}</Link></td>
                  <td data-label="Trạng thái" className="td">{trangThaiMap[d.doc] === "Đơn hủy" ? <Badge tone="red">Đơn hủy</Badge> : <Badge tone="green">Đã nhập</Badge>}</td>
                  <td data-label="Ngày nhập" className="td text-xs whitespace-nowrap">{fmtTime(d.created_at)}</td>
                  <td data-label="Kho" className="td text-[13px]">{locName(d.location_code)}</td>
                  <td data-label="NCC" className="td text-[13px]">{d.supplier || <span className="text-[#8A93A0]">—</span>}</td>
                  <td data-label="Xe" className="td text-[13px]">{d.so_ma} mã · <b>{d.so_xe} chiếc</b></td>
                  <td data-label="Người nhập" className="td text-xs">{d.by}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      <Link href={`/nhap-hang/${encodeURIComponent(d.doc)}`} className="btn-ghost !px-2 !py-1 !text-xs" title="Xem chi tiết phiếu">👁</Link>
                      {trangThaiMap[d.doc] !== "Đơn hủy" && (profile.role === "CEO" || perms["sua_kho_nhap"]) && (
                        <button className="btn-ghost !px-2 !py-1 !text-xs" title="Sửa kho nhập (chỉ khi toàn bộ xe còn Tồn kho)" onClick={() => { setSuaKhoDoc(suaKhoDoc === d.doc ? null : d.doc); setSuaKhoMoi(""); }}>✏️</button>
                      )}
                      {trangThaiMap[d.doc] === "Đơn hủy" && (profile.role === "CEO" || perms["sua_kho_nhap"]) && (
                        <button className="btn-ghost !px-2 !py-1 !text-xs" title="Khôi phục đơn đã hủy về Tồn kho" onClick={() => khoiPhucDon(d.doc)}>↩️</button>
                      )}
                      {trangThaiMap[d.doc] === "Đơn hủy" && ["ADMIN","CEO"].includes(profile.role) && (
                        <button className="btn-ghost !px-2 !py-1 !text-xs !text-danger" title="Xóa hẳn khỏi database (không thể hoàn tác)" onClick={() => xoaHanDon(d.doc)}>🗑</button>
                      )}
                    </div>
                  </td>
                </tr>,
                suaKhoDoc === d.doc && (
                  <tr key={d.doc + "_suakho"}><td colSpan={9} className="td bg-[#EAF2FF] !p-3">
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="font-semibold text-[13px] mr-2">✏️ Sửa kho nhập — {d.doc}</div>
                      <Field label="Kho mới">
                        <select className="inp !w-56" value={suaKhoMoi} onChange={(e) => setSuaKhoMoi(e.target.value)}>
                          <option value="">— Chọn kho mới —</option>
                          {locations.filter((l) => l.code !== d.location_code).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                        </select>
                      </Field>
                      <button className="btn-ok !text-xs" disabled={busy} onClick={() => luuSuaKho(d.doc)}>Lưu</button>
                      <button className="btn-ghost !text-xs" onClick={() => setSuaKhoDoc(null)}>Hủy</button>
                    </div>
                  </td></tr>
                ),
              ];})}
              {sorted.length === 0 && <tr><td className="td" colSpan={8}>Không có đơn nhập nào khớp bộ lọc.</td></tr>}
              </tbody>
            </table></div>
            <Pager total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </div>

      {/* CHI TIẾT PHIẾU */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto p-4" onClick={() => setDetail(null)}>
          <div className="card max-w-2xl w-full my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <div className="font-extrabold text-lg mr-auto">Phiếu nhập {detail.doc}</div>
              <button className="btn-ghost !text-xs" onClick={() => setDetail(null)}>✕ Đóng</button>
            </div>
            <div className="text-[13px] text-[#5A6572] mb-3">
              {fmtTime(detail.created_at)} · Kho {locName(detail.location_code)}
              {detail.supplier && ` · NCC ${detail.supplier}`} · Người nhập {detail.by}
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <div className="text-[13px]"><span className="text-[#8A93A0]">Số mã:</span> <b>{detail.so_ma}</b></div>
              <div className="text-[13px]"><span className="text-[#8A93A0]">Tổng xe:</span> <b>{detail.so_xe}</b></div>
            </div>
            <div className="flex flex-col gap-2">
              {detail.lines.map((l) => {
                const units = detail.units.filter((u) => u.vehicle_id === l.vehicle_id);
                return (
                  <div key={l.id} className="rounded-xl border border-[#E3E8EF] p-2.5">
                    <div className="flex items-center gap-2">
                      <b className="text-[13.5px] mr-auto">{vShort(l.vehicle_id)}</b>
                      <Badge tone="green">+{l.qty}</Badge>
                    </div>
                    {units.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap mt-2">
                        {units.map((u) => (
                          <span key={u.frame_number} className="inline-flex items-center gap-1 bg-[#F3F5F8] rounded-lg px-2 py-0.5 text-[11px] font-mono">
                            {u.frame_number}
                            {u.status !== "TON_KHO" && <span className="text-[9px] text-[#8A93A0]">({u.status})</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    {l.note && <div className="text-[11px] text-[#8A93A0] mt-1">{l.note}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NhapHang() {
  return <Suspense fallback={<div className="card">Đang tải…</div>}><NhapHangInner /></Suspense>;
}