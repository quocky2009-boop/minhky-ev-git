-- ============================================================
-- Migration 046 — KHÁCH LẺ CUỐI (đơn bán buôn)
-- Boi canh: dai ly mua buon nhieu xe, vai ngay sau moi ban le
-- cho khach cuoi. Theo quy dinh HANG (VinFast), hoa don phai
-- dung ten KHACH LE, khong phai dai ly.
--
-- Chot:
--  C1a: chi ap dung don co customer_type = 'Khách buôn'
--  C2 : moi xe (moi don) mot khach le rieng
--  C3 : CHAN xac nhan hoa don khi thieu khach le — CHI voi xe VINFAST
--  C4 : them cot email cho customers
--  Loai khach moi: 'Khách lẻ của Đại lý'
-- Chay SAU 045. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== 1) EMAIL CHO KHÁCH HÀNG =====================
alter table public.customers add column if not exists email text default '';
create index if not exists customers_email_idx on public.customers (lower(email)) where email <> '';

-- Loai khach moi
do $do$
declare v_def text;
begin
  select value into v_def from public.app_settings where key = 'customer_types';
  if v_def is null then
    insert into public.app_settings (key, value)
    values ('customer_types', E'Khách lẻ\nKhách buôn\nKhách CBNV\nKhách cũ\nĐối tác\nO2O\nKhách lẻ của Đại lý')
    on conflict (key) do nothing;
  elsif position('Khách lẻ của Đại lý' in v_def) = 0 then
    update public.app_settings set value = v_def || E'\nKhách lẻ của Đại lý' where key = 'customer_types';
  end if;
end $do$;

-- ===================== 2) CỘT KHÁCH LẺ CUỐI TRÊN ĐƠN =====================
alter table public.sales_orders add column if not exists end_customer_id bigint references public.customers(id);
alter table public.sales_orders add column if not exists end_customer_name text default '';
alter table public.sales_orders add column if not exists end_customer_phone text default '';
alter table public.sales_orders add column if not exists end_customer_email text default '';
alter table public.sales_orders add column if not exists end_customer_address text default '';   -- dia chi VNeID
alter table public.sales_orders add column if not exists end_customer_at timestamptz;
alter table public.sales_orders add column if not exists end_customer_by uuid references public.profiles(id);
alter table public.sales_orders add column if not exists end_customer_by_name text default '';
create index if not exists so_end_cust_idx on public.sales_orders (end_customer_id);

-- ===================== 3) HÀM: BỔ SUNG KHÁCH LẺ CUỐI =====================
create or replace function public.fn_luu_khach_le_cuoi(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; o record; v_cust bigint; v_phone text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') and not public.fn_co_quyen('sua_khach') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền cập nhật khách lẻ';
  end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;

  -- Bat buoc du 4 thong tin theo quy dinh hang
  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập họ tên khách lẻ'; end if;
  if coalesce(trim(p->>'phone'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập số điện thoại khách lẻ'; end if;
  if coalesce(trim(p->>'address'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập địa chỉ VNeID của khách lẻ'; end if;
  if coalesce(trim(p->>'email'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập email khách lẻ'; end if;
  if trim(p->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_SAI: email không hợp lệ';
  end if;

  v_phone := regexp_replace(trim(p->>'phone'), '\D', '', 'g');
  if length(v_phone) < 9 then raise exception 'SDT_SAI: số điện thoại không hợp lệ'; end if;

  -- Tao / cap nhat ho so khach le trong danh muc (loai: Khách lẻ của Đại lý)
  select id into v_cust from public.customers where phone_digits = v_phone limit 1;
  if v_cust is null then
    insert into public.customers (code, name, phone, cccd, address, email, customer_type, source,
      status, created_by, created_by_name)
    values (public.fn_gen_code('KH'), trim(p->>'name'), trim(p->>'phone'), '',
      trim(p->>'address'), lower(trim(p->>'email')), 'Khách lẻ của Đại lý',
      concat('Đại lý: ', o.customer_name), 'Đã mua', me.uid, me.name)
    returning id into v_cust;
  else
    update public.customers set
      name = trim(p->>'name'),
      address = coalesce(nullif(trim(p->>'address'),''), address),
      email = coalesce(nullif(lower(trim(p->>'email')),''), email),
      customer_type = case when customer_type in ('Khách lẻ','') then 'Khách lẻ của Đại lý' else customer_type end,
      status = 'Đã mua',
      last_purchase_at = now()
    where id = v_cust;
  end if;

  update public.sales_orders set
    end_customer_id = v_cust,
    end_customer_name = trim(p->>'name'),
    end_customer_phone = trim(p->>'phone'),
    end_customer_email = lower(trim(p->>'email')),
    end_customer_address = trim(p->>'address'),
    end_customer_at = now(), end_customer_by = me.uid, end_customer_by_name = me.name
  where id = o.id;

  perform public._notify_discord(jsonb_build_object('content',
    concat('👤 **Bổ sung khách lẻ cuối** · đơn ', o.code, ' · SK ', o.frame_number, E'\n',
      'Đại lý: ', o.customer_name, ' → Khách lẻ: ', trim(p->>'name'), ' (', trim(p->>'phone'), ')', E'\n',
      'Cập nhật bởi: ', me.name)));
  return v_cust;
end $$;

-- ===================== 4) CHẶN XÁC NHẬN HĐ KHI THIẾU KHÁCH LẺ (chỉ VinFast) =====================
create or replace function public.fn_xac_nhan_hoa_don(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_brand text; v_bh boolean; v_app boolean;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xac_nhan_hd') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền xác nhận hóa đơn'; end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;
  if o.invoice_status = 'Đã xuất HĐ' then raise exception 'TRANG_THAI_SAI: đơn này đã xác nhận rồi'; end if;
  if coalesce(trim(p->>'invoice_no'),'') = '' then
    raise exception 'THIEU_THONG_TIN: bắt buộc nhập số hóa đơn khi xác nhận';
  end if;

  select brand into v_brand from public.vehicles where id = o.vehicle_id;

  -- CHOT MOI: don BAN BUON xe VINFAST phai co khach le cuoi truoc khi xuat HD
  if o.customer_type = 'Khách buôn'
     and upper(coalesce(v_brand,'')) like '%VINFAST%'
     and coalesce(o.end_customer_id, 0) = 0 then
    raise exception 'THIEU_KHACH_LE: đơn bán buôn xe VinFast phải bổ sung thông tin khách lẻ cuối (họ tên, SĐT, địa chỉ VNeID, email) trước khi xuất hóa đơn';
  end if;

  v_bh  := coalesce((p->>'warranty_activated')::boolean, false);
  v_app := coalesce((p->>'app_activated')::boolean, false);
  if not v_bh then
    raise exception 'CHUA_KICH_HOAT_BAO_HANH: phải kích hoạt bảo hành cho xe trước khi hoàn thành đơn';
  end if;
  if upper(coalesce(v_brand,'')) like '%VINFAST%' and not v_app then
    raise exception 'CHUA_KICH_HOAT_APP: xe VinFast bắt buộc kích hoạt app VF eScooter trước khi hoàn thành đơn';
  end if;

  update public.sales_orders set
    invoice_status = 'Đã xuất HĐ',
    invoice_no = trim(p->>'invoice_no'),
    invoice_date = coalesce(nullif(p->>'invoice_date','')::date, current_date),
    invoice_by = me.uid, invoice_by_name = me.name, invoice_at = now(),
    warranty_activated = v_bh, app_activated = v_app
  where id = o.id;
end $$;

-- ===================== 5) VIEW: ĐƠN BUÔN CHỜ KHÁCH LẺ =====================
create or replace view public.v_don_cho_khach_le as
select o.id, o.code, o.sale_date, o.location_code, o.frame_number, o.vehicle_id,
  v.brand, v.name as ten_xe, v.color,
  o.customer_name as dai_ly, o.customer_phone as dai_ly_sdt,
  o.end_customer_name, o.end_customer_phone,
  (current_date - o.sale_date) as so_ngay,
  o.invoice_status
from public.sales_orders o
join public.vehicles v on v.id = o.vehicle_id
where o.customer_type = 'Khách buôn'
  and coalesce(o.end_customer_id, 0) = 0
  and upper(coalesce(v.brand,'')) like '%VINFAST%'
  and o.invoice_status <> 'Đã xuất HĐ';
