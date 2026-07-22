-- ============================================================
-- Migration 035 — FIX: tao khach moi bao loi customers_status_check
-- Loi: fn_luu_khach_hang (025) mac dinh status = 'Hồ sơ',
-- nhung bang customers chi cho phep:
--   'Lead mới','Đang tư vấn','Hẹn xem xe','Đã mua','Không mua','Chăm sóc lại'
-- Sua: mac dinh ve 'Lead mới' (dung y nghia khach moi tao).
-- Chay lai nhieu lan van an toan.
-- ============================================================

-- 1) Sua ham: chi thay gia tri mac dinh, giu nguyen toan bo logic con lai
do $do$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_luu_khach_hang'
  limit 1;
  if v_def is null then
    raise notice 'Khong tim thay fn_luu_khach_hang — bo qua.';
    return;
  end if;
  v_new := replace(v_def, '''Hồ sơ''', '''Lead mới''');
  if v_new = v_def then
    raise notice 'Ham khong chua gia tri Ho so — co the da duoc sua truoc do.';
  else
    execute v_new;
    raise notice 'Da sua fn_luu_khach_hang: status mac dinh -> Lead moi';
  end if;
end $do$;

-- 2) Don du lieu cu neu lo co ban ghi sai (thuc te chua luu duoc nen thuong = 0)
update public.customers set status = 'Lead mới'
where status is null or status not in ('Lead mới','Đang tư vấn','Hẹn xem xe','Đã mua','Không mua','Chăm sóc lại');
