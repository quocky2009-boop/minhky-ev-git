"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setErr(""); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setErr("Đăng nhập thất bại: sai email hoặc mật khẩu.");
    window.location.href = "/dashboard";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5"
      style={{ background: "linear-gradient(160deg,#0F2237 0%,#123055 55%,#0E4D3A 100%)" }}>
      <div className="bg-white rounded-3xl p-8 w-[420px] max-w-full shadow-2xl">
        <div className="text-2xl font-extrabold text-navy-900">MINH KỲ <span className="text-ok">EV</span></div>
        <p className="text-sm text-[#5A6572] mt-1 mb-6">Hệ thống quản lý xuất – nhập – tồn xe máy điện<br />VinFast & TAILG · Tuyên Quang</p>
        <label className="lbl">Email</label>
        <input className="inp mb-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@minhky.vn" />
        <label className="lbl">Mật khẩu</label>
        <input className="inp mb-4" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && signIn()} />
        {err && <div className="text-sm text-danger font-semibold mb-3">{err}</div>}
        <button className="btn-primary w-full" onClick={signIn} disabled={loading}>{loading ? "Đang đăng nhập…" : "Đăng nhập"}</button>
        <p className="text-xs text-[#8A93A0] mt-4">Tài khoản do BGĐ/Admin cấp. Quên mật khẩu: liên hệ quản trị hệ thống.</p>
      </div>
    </div>
  );
}
