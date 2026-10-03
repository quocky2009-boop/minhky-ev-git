-- =====================================================================
-- 143_fn_tai_khoan_chon_cho_moi_vai_tro.sql
-- LOI: nhan vien kinh doanh (SALES) chon "Chuyen khoan" khi tao/sua don khong thay
-- danh sach tai khoan nhan tien, vi RLS bang cash_accounts chi cho CEO/ADMIN/MANAGER doc
-- (bang co so du dau ky).
-- SUA: RPC fn_tai_khoan_chon() (SECURITY DEFINER) tra ve thong tin hien thi cua moi tai khoan
-- (id, name, type, bank_info, company_id, location_code, status) - KHONG co so du - cho moi
-- nguoi dung dang nhap. Wizard, form ban buon, danh sach/chi tiet don ban dung RPC nay.
-- =====================================================================
create or replace function public.fn_tai_khoan_chon()
returns table (id bigint, name text, type text, bank_info text, company_id bigint, location_code text, status text)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.type, a.bank_info, a.company_id, a.location_code, a.status
  from public.cash_accounts a
  where auth.uid() is not null
  order by a.type, a.name
$$;
revoke all on function public.fn_tai_khoan_chon() from public, anon;
grant execute on function public.fn_tai_khoan_chon() to authenticated;
