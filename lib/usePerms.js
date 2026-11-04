"use client";
import { useEffect, useState } from "react";

// Quyen theo vai tro (role_perms). CEO luon co moi quyen. Dung: const can = usePerms(supabase, profile); can("bb_lo")
export function usePerms(supabase, profile) {
  const [m, setM] = useState({});
  useEffect(() => {
    if (!profile || profile.role === "CEO") return;
    supabase.from("role_perms").select("perm,allowed").eq("role", profile.role).then(({ data }) => {
      const x = {}; (data || []).forEach((r) => { x[r.perm] = r.allowed; }); setM(x);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);
  return (k) => profile?.role === "CEO" || !!m[k];
}
