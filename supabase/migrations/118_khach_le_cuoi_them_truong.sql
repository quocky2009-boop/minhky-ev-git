-- ============================================================
-- Migration: Bổ sung 3 trường cho "Khách lẻ cuối" (đứng tên hóa đơn
-- khi đơn gốc là Khách buôn):
--  - end_customer_type: Loại khách hàng (chọn từ CUSTOMER_TYPES)
--  - end_customer_invoice_amount: Số tiền hóa đơn riêng
--  - end_customer_battery_option: Hình thức kinh doanh pin (Kèm
--    pin/Thuê pin) — CHỈ áp dụng khi xe bán là model_pin='Xe đổi pin'
-- Chạy sau 117. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

alter table public.sales_orders add column if not exists end_customer_type text default '';
alter table public.sales_orders add column if not exists end_customer_invoice_amount bigint;
alter table public.sales_orders add column if not exists end_customer_battery_option text
  check (end_customer_battery_option in ('Kèm pin','Thuê pin'));

create or replace function public.fn_luu_khach_le_cuoi(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; o record; v_cust bigint; v_phone text; v_model_pin text;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('xuat_ban') and not public.fn_co_quyen('sua_khach') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền cập nhật khách lẻ';
  end if;

  select * into o from public.sales_orders where id = (p->>'id')::bigint for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn không tồn tại'; end if;

  if coalesce(trim(p->>'name'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập họ tên khách lẻ'; end if;
  if coalesce(trim(p->>'phone'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập số điện thoại khách lẻ'; end if;
  if coalesce(trim(p->>'address'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập địa chỉ VNeID của khách lẻ'; end if;
  if coalesce(trim(p->>'email'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập email khách lẻ'; end if;
  if trim(p->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_SAI: email không hợp lệ';
  end if;

  v_phone := regexp_replace(trim(p->>'phone'), '\D', '', 'g');
  if length(v_phone) < 9 then raise exception 'SDT_SAI: số điện thoại không hợp lệ'; end if;

  select v.model_pin into v_model_pin from public.vehicles v where v.id = o.vehicle_id;
  if v_model_pin = 'Xe đổi pin' and coalesce(nullif(p->>'battery_option',''), '') = '' then
    raise exception 'THIEU_THONG_TIN: xe Đổi pin bắt buộc chọn Hình thức kinh doanh pin (Kèm pin/Thuê pin)';
  end if;

  select id into v_cust from public.customers where phone_digits = v_phone limit 1;
  if v_cust is null then
    insert into public.customers (code, name, phone, cccd, address, email, customer_type, source,
      status, created_by, created_by_name)
    values (public.fn_gen_code('KH'), trim(p->>'name'), trim(p->>'phone'), '',
      trim(p->>'address'), lower(trim(p->>'email')),
      coalesce(nullif(trim(p->>'customer_type'),''), 'Khách lẻ của Đại lý'),
      concat('Đại lý: ', o.customer_name), 'Đã mua', me.uid, me.name)
    returning id into v_cust;
  else
    update public.customers set
      name = trim(p->>'name'),
      address = coalesce(nullif(trim(p->>'address'),''), address),
      email = coalesce(nullif(lower(trim(p->>'email')),''), email),
      customer_type = coalesce(nullif(trim(p->>'customer_type'),''),
        case when customer_type in ('Khách lẻ','') then 'Khách lẻ của Đại lý' else customer_type end),
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
    end_customer_type = coalesce(nullif(trim(p->>'customer_type'),''), 'Khách lẻ của Đại lý'),
    end_customer_invoice_amount = nullif(p->>'invoice_amount','')::bigint,
    end_customer_battery_option = nullif(p->>'battery_option',''),
    end_customer_at = now(), end_customer_by = me.uid, end_customer_by_name = me.name
  where id = o.id;

  perform public._notify_discord(jsonb_build_object('content',
    concat('👤 Bổ sung khách lẻ cuối cho đơn ', o.code, ' — ', trim(p->>'name'), ' · ', me.name)));

  return v_cust;
end $$;

