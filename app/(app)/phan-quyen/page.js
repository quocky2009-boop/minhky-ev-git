"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Toast, Badge } from "@/components/ui";

const ROLES_LIST = [
  { key: "SALES", label: "Sales", color: "bg-blue-500" },
  { key: "TECHNICIAN", label: "KTV", color: "bg-purple-500" },
  { key: "MANAGER", label: "Cửa hàng trưởng", color: "bg-amber-500" },
  { key: "ADMIN", label: "Admin", color: "bg-green-600" },
];

const PERM_GROUPS = [
  { group: "Kho & hàng hóa", icon: "📦", items: [
    { key: "nhap_hang", label: "Nhập hàng vào kho", desc: "Tạo phiếu nhập, thêm xe vào tồn" },
    { key: "xuat_ban", label: "Tạo đơn xuất bán", desc: "Tạo và sửa đơn bán hàng" },
    { key: "dieu_chuyen", label: "Tạo phiếu điều chuyển", desc: "Chuyển xe giữa các kho" },
    { key: "dieu_chinh", label: "Đề xuất điều chỉnh tồn", desc: "Gửi yêu cầu điều chỉnh số lượng" },
    { key: "duyet_dieu_chinh", label: "Duyệt điều chỉnh tồn", desc: "Phê duyệt yêu cầu điều chỉnh" },
    { key: "kiem_ke", label: "Kiểm kê", desc: "Thực hiện kiểm kê tồn kho" },
    { key: "nhap_tu_phieu", label: "Nhập kho từ phiếu quét gom", desc: "Nhập xe từ danh sách quét mã" },
  ]},
  { group: "Đơn bán", icon: "🛒", items: [
    { key: "xac_nhan_hd", label: "Xác nhận đã xuất hóa đơn", desc: "Hoàn thành đơn bán" },
    { key: "sua_thanh_toan", label: "Cập nhật số tiền đã thanh toán", desc: "Thu tiền thêm hoặc hoàn tiền" },
    { key: "duyet_sua_don", label: "Duyệt điều chỉnh giá đơn", desc: "Phê duyệt yêu cầu sửa giá" },
  ]},
  { group: "Sổ quỹ", icon: "💰", items: [
    { key: "thu_chi_chot", label: "Xem/tạo phiếu thu chi & duyệt", desc: "Truy cập Sổ quỹ, duyệt phiếu chi" },
  ]},
  { group: "Dữ liệu", icon: "📋", items: [
    { key: "sua_danh_muc", label: "Thêm/sửa danh mục xe, kho, NCC", desc: "Quản lý danh mục hệ thống" },
    { key: "sua_unit", label: "Sửa thông tin xe theo số khung", desc: "Chỉnh sửa thông tin xe cụ thể" },
    { key: "sua_khach", label: "Thêm/sửa khách hàng", desc: "Quản lý hồ sơ khách hàng" },
  ]},
  { group: "Dịch vụ", icon: "🔧", items: [
    { key: "dv_tiep_nhan", label: "Tiếp nhận xe vào dịch vụ", desc: "" },
    { key: "dv_chan_doan", label: "Chẩn đoán kỹ thuật", desc: "" },
    { key: "dv_bao_gia", label: "Lập báo giá / giảm giá", desc: "" },
    { key: "dv_thu_tien", label: "Thu tiền dịch vụ", desc: "" },
    { key: "dv_nghiem_thu", label: "Nghiệm thu", desc: "" },
    { key: "dv_giao_xe", label: "Giao xe cho khách", desc: "" },
    { key: "dv_eod", label: "Duyệt công nợ & chốt ngày (EOD)", desc: "" },
    { key: "dv_huy_phieu", label: "Hủy phiếu dịch vụ", desc: "" },
  ]},
  { group: "Kho phụ tùng", icon: "🔩", items: [
    { key: "pt_danh_muc", label: "Sửa danh mục phụ tùng & bảng giá công", desc: "" },
    { key: "pt_nhap", label: "Nhập kho phụ tùng", desc: "" },
    { key: "pt_xuat", label: "Xuất vật tư theo phiếu", desc: "" },
    { key: "pt_kiem_ke", label: "Kiểm kê phụ tùng", desc: "" },
  ]},
  { group: "Công việc", icon: "✅", items: [
    { key: "task_tu_tao", label: "Tự tạo việc cho mình", desc: "" },
    { key: "task_giao_viec", label: "Giao việc cho người khác", desc: "" },
  ]},
  { group: "Quản trị", icon: "⚙️", items: [
    { key: "xem_bao_cao", label: "Xem báo cáo", desc: "" },
    { key: "cai_dat", label: "Vào trang Cài đặt", desc: "" },
  ]},
];

export default function PhanQuyen() {
  const { supabase, profile, loading } = useCatalog();
  const { toast, notify } = useToast();
  const [perms, setPerms] = useState({}); // { "SALES:nhap_hang": true, ... }
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("role_perms").select("*");
    const m = {};
    (data || []).forEach(r => { m[`${r.role}:${r.perm}`] = r.allowed; });
    setPerms(m); setChanged(false);
  };
  useEffect(() => { if (!loading) load(); }, [loading]);

  if (loading || !profile) return <div className="card">Đang tải…</div>;
  if (profile.role !== "CEO") return <div className="card text-danger">Chỉ Ban giám đốc được quản lý phân quyền.</div>;

  const toggle = (role, perm) => {
    const key = `${role}:${perm}`;
    setPerms(p => ({ ...p, [key]: !p[key] }));
    setChanged(true);
  };

  const get = (role, perm) => !!perms[`${role}:${perm}`];

  const luu = async () => {
    setBusy(true);
    // Upsert tat ca thay doi
    const rows = [];
    PERM_GROUPS.forEach(g => g.items.forEach(item => {
      ROLES_LIST.forEach(r => {
        rows.push({ role: r.key, perm: item.key, allowed: get(r.key, item.key) });
      });
    }));
    const { error } = await supabase.from("role_perms").upsert(rows, { onConflict: "role,perm" });
    setBusy(false);
    if (error) return notify("Lỗi lưu phân quyền: " + error.message, "err");
    notify("Đã lưu phân quyền. Nhân viên cần reload trang để áp dụng.");
    setChanged(false);
  };

  const batTatToan = (role, value) => {
    const updates = {};
    PERM_GROUPS.forEach(g => g.items.forEach(item => {
      updates[`${role}:${item.key}`] = value;
    }));
    setPerms(p => ({ ...p, ...updates }));
    setChanged(true);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Toast toast={toast} />

      {/* HEADER */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="font-extrabold text-xl">Phân quyền theo vai trò</div>
          <div className="text-[13px] text-[#5A6572]">CEO luôn có toàn quyền. Bảng này cấu hình quyền cho các vai trò còn lại.</div>
        </div>
        <div className="ml-auto flex gap-2">
          {changed && <button className="btn-ghost !text-xs" onClick={load}>↩ Hoàn tác</button>}
          <button className="btn-ok !px-6" disabled={busy || !changed} onClick={luu}>
            {busy ? "Đang lưu…" : "💾 Lưu thay đổi"}
          </button>
        </div>
      </div>

      {changed && (
        <div className="p-2.5 rounded-xl bg-[#FDF1DF] text-[13px] text-[#A25F00] font-semibold">
          ⚠ Có thay đổi chưa được lưu — bấm "Lưu thay đổi" để áp dụng.
        </div>
      )}

      {/* BẢNG PHÂN QUYỀN */}
      <div className="card !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#1E2B3C] text-white text-[12px]">
                <th className="text-left px-4 py-3 font-semibold w-64">Quyền</th>
                {ROLES_LIST.map(r => (
                  <th key={r.key} className="text-center px-2 py-3 font-semibold min-w-[100px]">
                    <div>{r.label}</div>
                    <div className="flex gap-1 justify-center mt-1.5">
                      <button className="text-[9px] bg-green-500 hover:bg-green-400 rounded px-1.5 py-0.5" onClick={() => batTatToan(r.key, true)}>Tất cả</button>
                      <button className="text-[9px] bg-red-500 hover:bg-red-400 rounded px-1.5 py-0.5" onClick={() => batTatToan(r.key, false)}>Xóa hết</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERM_GROUPS.map((g, gi) => (
                <>
                  <tr key={g.group} className="bg-[#F3F5F8]">
                    <td colSpan={ROLES_LIST.length + 1} className="px-4 py-2 font-bold text-[12px] text-[#3D4E6C] uppercase tracking-wide">
                      {g.icon} {g.group}
                    </td>
                  </tr>
                  {g.items.map((item, ii) => (
                    <tr key={item.key} className={`border-b border-[#F0F2F5] ${ii % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]"} hover:bg-[#EAF2FF]`}>
                      <td className="px-4 py-2.5">
                        <div className="text-[13px] font-medium">{item.label}</div>
                        {item.desc && <div className="text-[11px] text-[#8A93A0]">{item.desc}</div>}
                      </td>
                      {ROLES_LIST.map(r => (
                        <td key={r.key} className="text-center px-2 py-2.5">
                          <label className="inline-flex items-center justify-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-5 h-5 rounded cursor-pointer accent-blue-600"
                              checked={get(r.key, item.key)}
                              onChange={() => toggle(r.key, item.key)}
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CHÚ THÍCH */}
      <div className="card !py-3 text-[12.5px] text-[#5A6572]">
        <div className="font-semibold mb-1">Lưu ý:</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Quyền trong bảng này cho phép thực hiện hành động — không phải quyền xem menu.</li>
          <li>Một số menu chỉ hiện khi có quyền tương ứng (VD: Nhập hàng cần quyền "Nhập hàng vào kho").</li>
          <li>Nhân viên cần <b>tải lại trang</b> sau khi thay đổi phân quyền để áp dụng.</li>
          <li>CEO luôn có toàn quyền, không bị ảnh hưởng bởi bảng này.</li>
        </ul>
      </div>
    </div>
  );
}
