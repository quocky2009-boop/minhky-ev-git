import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return <AppShell profile={profile || { name: user.email, role: "SALES" }}>{children}</AppShell>;
}
