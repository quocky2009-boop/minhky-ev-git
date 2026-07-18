-- ============================================================
-- Migration 027:
-- A) NOI DAY phan quyen dong: thay guard role cung trong cac ham
--    nghiep vu bang fn_co_quyen('<perm>').
--    Cach lam: doc dinh nghia ham hien tai (pg_get_functiondef),
--    thay dong guard dau tien, tao lai ham. Ham nao khong khop
--    mau guard thi GIU NGUYEN (bao qua NOTICE) - khong hong gi.
-- B) Xac nhan HOA DON kem KICH HOAT BAO HANH + APP VF eScooter.
-- Chay SAU 026, 1 lan duy nhat. Chay lai duoc nhieu lan.
-- ============================================================

-- ---------- A) NOI DAY ----------
do $do$
declare
  m record; r record; v_def text; v_new text; v_ok int := 0; v_skip text := '';
  map jsonb := jsonb_build_object(
    'fn_nhap_hang','nhap_hang',
    'fn_import_units','nhap_hang',
    'fn_ban_hang','xuat_ban',
    'fn_ban_buon','xuat_ban',
    'fn_tao_dieu_chuyen','dieu_chuyen',
    'fn_de_xuat_dieu_chinh','dieu_chinh',
    'fn_duyet_dieu_chinh','duyet_dieu_chinh',
    'fn_nhap_tu_phieu','nhap_tu_phieu',
    'fn_import_pool','nhap_tu_phieu',
    'fn_tao_lo_import','nhap_tu_phieu',
    'fn_xoa_lo','nhap_tu_phieu',
    'fn_xoa_pool','nhap_tu_phieu',
    'fn_cap_nhat_thanh_toan','sua_thanh_toan',
    'fn_duyet_sua_don','duyet_sua_don',
    'fn_them_xe','sua_danh_muc',
    'fn_sua_xe','sua_danh_muc',
    'fn_import_xe','sua_danh_muc',
    'fn_doi_ma_xe','sua_danh_muc',
    'fn_them_hang','sua_danh_muc',
    'fn_them_kho','sua_danh_muc',
    'fn_sua_kho','sua_danh_muc',
    'fn_xoa_kho','sua_danh_muc',
    'fn_sua_unit','sua_unit',
    'fn_sua_so_khung','sua_unit',
    'fn_luu_khach_hang','sua_khach',
    'fn_set_setting','cai_dat',
    'fn_save_custom_field','cai_dat',
    'fn_delete_custom_field','cai_dat'
  );
begin
  for m in select key as fname, value as perm from jsonb_each_text(map) loop
    for r in
      select p.oid from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = m.fname
    loop
      v_def := pg_get_functiondef(r.oid);
      -- chi thay guard role cung dau tien
      v_new := regexp_replace(
        v_def,
        'if\s+me\.role\s+not\s+in\s*\([^)]*\)\s+then',
        'if not public.fn_co_quyen(' || quote_literal(m.perm) || ') then',
        'i'
      );
      if v_new = v_def then
        v_skip := v_skip || m.fname || ' ';
      else
        execute v_new;
        v_ok := v_ok + 1;
      end if;
    end loop;
  end loop;
  raise notice 'Da noi day phan quyen cho % ham.', v_ok;
  if v_skip <> '' then
    raise notice 'Giu nguyen (khong tim thay guard role, thuong la ham von cho moi vai tro): %', v_skip;
  end if;
end $do$;

-- ---------- B) HOA DON + BAO HANH + APP ----------
alter table public.sales_orders add column if not exists warranty_activated boolean not null default false;
alter table public.sales_orders add column if not exists app_activated boolean not null default false;

create or replace function public.fn_xac_nhan_hoa_don(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_brand text; v_bh boolean; v_app boolean;
begin
  select * into me from public.fn_me();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xac_nhan_hd') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền xác nhận hóa đơn'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.invoice_status = 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn này đã xác nhận rồi'; end if;
  if coalesce(trim(p->>'invoice_no'),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập số hóa đơn khi xác nhận';
  end if;

  v_bh  := coalesce((p->>'warranty_activated')::boolean, false);
  v_app := coalesce((p->>'app_activated')::boolean, false);

  if not v_bh then
    raise exception 'CHUA_KICH_HOAT_BAO_HANH: phải kích hoạt bảo hành cho xe trước khi hoàn thành đơn';
  end if;

  select brand into v_brand from public.vehicles where id = o.vehicle_id;
  if upper(coalesce(v_brand,'')) like '%VINFAST%' and not v_app then
    raise exception 'CHUA_KICH_HOAT_APP: xe VinFast bắt buộc kích hoạt app VF eScooter trước khi hoàn thành đơn';
  end if;

  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now(),
    warranty_activated = v_bh,
    app_activated = v_app
  where id = o.id;
end $$;

create or replace function public.fn_huy_xac_nhan_hoa_don(p_id bigint, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được hủy xác nhận hóa đơn'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  if o.invoice_status <> 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn chưa xác nhận HĐ'; end if;
  update public.sales_orders set
    invoice_status = 'Chờ xuất HĐ', invoice_no = '', invoice_date = null,
    invoice_by = null, invoice_by_name = '', invoice_at = null,
    warranty_activated = false, app_activated = false,
    note = trim(both ' | ' from coalesce(nullif(note,''),'') || ' | ' ||
      'Hủy xác nhận HĐ '||coalesce(nullif(o.invoice_no,''),'(trống)')||' bởi '||me.name||
      coalesce(nullif(' — lý do: '||p_ly_do,' — lý do: '),''))
  where id = p_id;
end $$;
