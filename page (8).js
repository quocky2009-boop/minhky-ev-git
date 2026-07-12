"use client";
import { useEffect, useState } from "react";
import { useCatalog, useToast } from "@/lib/useData";
import { Badge, Toast } from "@/components/ui";
import { ROLES } from "@/lib/const";
import { errMsg } from "@/lib/format";

export default function NguoiDung() {
  const { supabase, profile, loading, regions } = useCatalog();
  const { toast, notify } = useToast();
  const [users, setUsers] = useState([]);

  const load = async () => {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setUsers(data || []);
  };
  useEffect(() => { load(); }, []);

  const setRole = async (u, role, region) => {
    const { error } = await supabase.rpc("fn_set_role", { p_user: u.id, p_role: role, p_region: region || null });
    if (error) return notify(errMsg(error), "err");
    notify(`Đã cập nhật quyền cho ${u.name}.`); load();
  };

  if (loading || !profile) return <div className="card">Đang tải dữ liệu…</div>;

  return (
    <div className="flex flex-col gap-4">
      <Toast toast={toast} />
      <div className="card">
        <div className="font-extrabold mb-1">Người dùng & phân quyền ({users.length})</div>
        <p className="text-xs text-[#5A6572] mb-3">Tạo tài khoản mới: vào Supabase → Authentication → Add user (email + mật khẩu). Tài khoản mới mặc định là Sales, CEO phân quyền lại tại đây.</p>
        <div className="overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className="th">Người dùng</th><th className="th">Vai trò</th><th className="th">Khu vực (với Quản lý)</th><th className="th">Trạng thái</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td className="td font-bold">{u.name}</td>
              <td className="td">
                <select className="inp !w-auto !py-1.5 !text-xs" value={u.role} onChange={(e) => setRole(u, e.target.value, u.region)}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className="td">
                <select className="inp !w-auto !py-1.5 !text-xs" value={u.region || ""} onChange={(e) => setRole(u, u.role, e.target.value)}>
                  <option value="">Toàn hệ thống</option>{regions.map((r) => <option key={r}>{r}</option>)}
                </select>
              </td>
              <td className="td"><Badge tone="green">{u.status}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card text-sm text-[#3B4552]">
        <b>Nguyên tắc cứng của hệ thống:</b> Sales không sửa tồn trực tiếp · Tồn chỉ thay đổi qua giao dịch (nhập / bán / điều chuyển đã xác nhận / điều chỉnh đã duyệt) · Bán vượt tồn bị chặn ngay tại database · Mọi thao tác ghi người thực hiện và thời gian · Lịch sử không xóa được.
      </div>
    </div>
  );
}
