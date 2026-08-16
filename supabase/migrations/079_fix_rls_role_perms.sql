-- ============================================================
-- Migration 079: Fix RLS role_perms — thiếu policy INSERT/UPDATE/DELETE
-- Nguyên nhân lỗi "new row violates row-level security policy for
-- table role_perms": bảng chỉ có policy SELECT (migration 026),
-- không có policy cho phép ghi -> upsert từ trang Phân quyền bị chặn.
-- Chỉ cho phép ADMIN/CEO ghi. Chạy 1 lần.
-- ============================================================

create policy "write_role_perms" on public.role_perms
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN','CEO'))
  );

create policy "update_role_perms" on public.role_perms
  for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN','CEO'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN','CEO'))
  );

create policy "delete_role_perms" on public.role_perms
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('ADMIN','CEO'))
  );
