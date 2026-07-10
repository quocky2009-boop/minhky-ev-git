-- ============================================================
-- Migration 006: Them moi kho / cua hang. Chay SAU 005, 1 lan.
-- ============================================================
create or replace function public.fn_them_kho(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_prefix text; v_slug text; n int := 0;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được thêm kho'; end if;
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: cần tên kho'; end if;
  v_prefix := case p->>'region' when 'Thành phố' then 'TP' when 'Hàm Yên' then 'HY' else 'KH' end;
  -- Sinh ma kho: KHUVUC_TEN (khong dau, viet hoa), tranh trung bang hau to so
  v_slug := upper(regexp_replace(translate(trim(p->>'name'),
    'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ',
    'aaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiioooooooooooooooooquuuuuuuuuuuyyyyydAAAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOQUUUUUUUUUUUYYYYYD'),
    '[^a-zA-Z0-9]+', '_', 'g'));
  v_code := v_prefix || '_' || v_slug;
  while exists (select 1 from public.locations where code = v_code) loop
    n := n + 1; v_code := v_prefix || '_' || v_slug || '_' || n::text;
  end loop;
  insert into public.locations (code, name, region, type, address, status)
  values (v_code, trim(p->>'name'), coalesce(nullif(p->>'region',''),'Thành phố'),
          coalesce(nullif(p->>'type',''),'Cửa hàng'), coalesce(p->>'address',''),
          coalesce(nullif(p->>'status',''),'Hoạt động'));
  return v_code;
end $$;
