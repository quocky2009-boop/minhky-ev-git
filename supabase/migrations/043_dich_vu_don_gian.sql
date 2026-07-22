-- ============================================================
-- Migration 043 — ĐƠN GIẢN HÓA MODULE DỊCH VỤ
-- Theo yeu cau:
--  (1) Phu tung GO TAY tren phieu, khong tru kho phu tung
--  (2) Bo quan ly serial pin
--  (4) Anh hien trang xe: TUY CHON (bo bat buoc 4 anh)
--  (5) Bao gia + thanh toan ngay trong phieu tiep nhan;
--      giam gia: theo % tung dong / % ca don / so tien
--  (6) Bo buoc "khach dong y bao gia"
--  (7) Bo bat buoc anh khi thu tien mat
--  (8) Gop Nghiem thu + Giao xe thanh 1 thao tac
-- Chay SAU 042d. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== 1) CỘT MỚI CHO GIẢM GIÁ LINH HOẠT =====================
alter table public.dv_tickets add column if not exists discount_type text not null default 'amount'
  check (discount_type in ('amount','percent'));
alter table public.dv_tickets add column if not exists discount_percent numeric not null default 0;
-- Giam gia theo % tren TUNG DONG
alter table public.dv_ticket_lines add column if not exists discount_percent numeric not null default 0;

-- Dong hang muc: cho phep GO TAY phu tung (part_id de trong)
alter table public.dv_ticket_lines alter column part_id drop not null;

-- ===================== 2) TIẾP NHẬN: ẢNH LÀ TÙY CHỌN =====================
create or replace function public.fn_dv_tao_phieu(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text; v_region text; v_cust bigint;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('dv_tiep_nhan') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền tiếp nhận xe'; end if;
  if coalesce(p->>'location_code','') = '' then raise exception 'THIEU_THONG_TIN: chọn điểm dịch vụ'; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách';
  end if;
  -- (4) BO kiem tra bat buoc 4 anh — anh la tuy chon

  select region into v_region from public.locations where code = p->>'location_code';
  v_cust := nullif(p->>'customer_id','')::bigint;
  if v_cust is null then
    v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', '',
      coalesce(p->>'customer_address',''), 'Khách lẻ', 'Dịch vụ', me.uid, me.name);
  end if;
  v_code := public.fn_next_code('DV');
  insert into public.dv_tickets (code, location_code, region, customer_id, customer_name, customer_phone,
    frame_number, vehicle_desc, odo_km, battery_pct, assets_note, request_note, photos,
    diagnose_note, ktv_id, ktv_name, status, received_by, received_by_name)
  values (v_code, p->>'location_code', v_region, v_cust, p->>'customer_name', p->>'customer_phone',
    coalesce(p->>'frame_number',''), coalesce(p->>'vehicle_desc',''),
    nullif(p->>'odo_km','')::int, nullif(p->>'battery_pct','')::int,
    coalesce(p->>'assets_note',''), coalesce(p->>'request_note',''), coalesce(p->'photos','[]'::jsonb),
    coalesce(p->>'diagnose_note',''),
    coalesce(nullif(p->>'ktv_id','')::uuid, me.uid), coalesce(nullif(p->>'ktv_name',''), me.name),
    'TIEP_NHAN', me.uid, me.name);
  perform public._dv_log('ticket', v_code, 'tiep_nhan', null, p, '');
  perform public._notify_discord(jsonb_build_object('content',
    concat('🔧 **Phiếu dịch vụ mới ', v_code, '** · ', p->>'customer_name', ' (', p->>'customer_phone', ') · ',
      coalesce(nullif(p->>'vehicle_desc',''), concat('SK ', coalesce(p->>'frame_number','?'))),
      ' · điểm ', p->>'location_code', ' · ', me.name)));
  return v_code;
end $$;

-- ===================== 3) BÁO GIÁ: GÕ TAY + GIẢM GIÁ LINH HOẠT =====================
-- Bo buoc "khach duyet": dong duoc luu la DA DUYET ngay (approved = true)
create or replace function public.fn_dv_luu_bao_gia(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; r jsonb; v_amount bigint; v_dp numeric;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_bao_gia') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền lập báo giá'; end if;
  select * into t from public.dv_tickets where id = (p->>'id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status in ('DA_GIAO','HUY') then raise exception 'TRANG_THAI_SAI: phiếu đã đóng'; end if;

  -- Ghi de toan bo hang muc (khong con khai niem "da xuat kho")
  delete from public.dv_ticket_lines where ticket_id = t.id;
  for r in select jsonb_array_elements(coalesce(p->'lines','[]'::jsonb)) loop
    if coalesce(trim(r->>'name'),'') = '' then continue; end if;
    v_dp := coalesce((r->>'discount_percent')::numeric, 0);
    v_amount := round(
      greatest(coalesce((r->>'qty')::int,1),1) * coalesce((r->>'unit_price')::bigint,0)
      * (1 - least(greatest(v_dp,0),100) / 100.0)
    );
    insert into public.dv_ticket_lines (ticket_id, line_type, service_id, part_id, part_serial,
      name, qty, unit_price, discount_percent, amount, approved, exported, note)
    values (t.id, coalesce(r->>'line_type','CONG'),
      nullif(r->>'service_id','')::bigint, null, '',
      trim(r->>'name'), greatest(coalesce((r->>'qty')::int,1),1),
      coalesce((r->>'unit_price')::bigint,0), v_dp, v_amount,
      true, true, coalesce(r->>'note',''));   -- (6) mac dinh da duyet, khong cho xuat kho
  end loop;

  update public.dv_tickets set
    discount_type = coalesce(nullif(p->>'discount_type',''), 'amount'),
    discount_percent = coalesce((p->>'discount_percent')::numeric, 0),
    discount = coalesce((p->>'discount')::bigint, 0),
    discount_note = coalesce(p->>'discount_note', discount_note),
    discount_by = me.uid, discount_by_name = me.name,
    customer_approved_at = coalesce(customer_approved_at, now()),   -- (6) tu duyet
    status = case when status = 'TIEP_NHAN' then 'DANG_LAM' else status end
  where id = t.id;
  perform public._dv_log('ticket', t.code, 'bao_gia', null, p, '');
end $$;

-- Tong tien: ap dung giam theo % ca don hoac so tien
create or replace view public.v_dv_ticket_tong as
select t.id as ticket_id, t.code,
  greatest(
    case when t.discount_type = 'percent'
      then round(coalesce((select sum(l.amount) from public.dv_ticket_lines l where l.ticket_id = t.id), 0)
                 * (1 - least(greatest(t.discount_percent,0),100) / 100.0))
      else coalesce((select sum(l.amount) from public.dv_ticket_lines l where l.ticket_id = t.id), 0) - t.discount
    end, 0) as tong,
  coalesce((select sum(p.amount) from public.dv_payments p where p.ticket_id = t.id), 0) as da_thu,
  t.debt_approved
from public.dv_tickets t;

-- ===================== 4) THU TIỀN: BỎ BẮT BUỘC ẢNH =====================
create or replace function public.fn_dv_thu_tien(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; t record; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_thu_tien') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền thu tiền'; end if;
  select * into t from public.dv_tickets where id = (p->>'ticket_id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status = 'HUY' then raise exception 'TRANG_THAI_SAI: phiếu đã hủy'; end if;
  if me.role not in ('ADMIN','CEO') and not exists (
    select 1 from public.dv_collectors c where c.user_id = me.uid and c.location_code = t.location_code and c.active
  ) then
    raise exception 'KHONG_TRONG_DANH_SACH: bạn chưa được chỉ định thu tiền tại điểm % — nhờ CHT gán trong Cài đặt', t.location_code;
  end if;
  if coalesce((p->>'amount')::bigint, 0) <= 0 then raise exception 'THAM_SO_SAI: số tiền phải > 0'; end if;
  -- (7) BO kiem tra bat buoc anh khi thu tien mat

  v_code := public.fn_next_code('PTDV');
  insert into public.dv_payments (code, ticket_id, method, amount, evidence, collected_by, collected_by_name, note)
  values (v_code, t.id, p->>'method', (p->>'amount')::bigint, coalesce(p->'evidence','[]'::jsonb),
          me.uid, me.name, coalesce(p->>'note',''));

  perform public._auto_thu(t.location_code, p->>'method', (p->>'amount')::bigint,
    'Thu dịch vụ', t.customer_name, concat('Phiếu DV ', t.code, ' — ', v_code), v_code, me.uid, me.name);

  perform public._dv_log('ticket', t.code, 'thu_tien', null,
    jsonb_build_object('code', v_code, 'method', p->>'method', 'amount', p->>'amount'), '');
  perform public._notify_discord(jsonb_build_object('content',
    concat('💵 **Thu tiền DV** ', v_code, ' · phiếu ', t.code, ' · ', p->>'method', ' ',
           to_char((p->>'amount')::bigint, 'FM999,999,999,999'), 'đ · ', me.name)));
  return v_code;
end $$;

-- ===================== 5) GỘP NGHIỆM THU + GIAO XE =====================
create or replace function public.fn_dv_hoan_tat(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; t record; v record;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_giao_xe') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền giao xe'; end if;
  select * into t from public.dv_tickets where id = p_id for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status in ('DA_GIAO','HUY') then raise exception 'TRANG_THAI_SAI: phiếu đã đóng'; end if;
  if not exists (select 1 from public.dv_ticket_lines where ticket_id = p_id) then
    raise exception 'THIEU_THONG_TIN: phiếu chưa có hạng mục nào';
  end if;

  select * into v from public.v_dv_ticket_tong where ticket_id = p_id;
  if v.da_thu + v.debt_approved < v.tong then
    raise exception 'CHUA_DU_TIEN: phải thu %đ, đã thu %đ, công nợ duyệt %đ — thu đủ hoặc duyệt công nợ trước khi giao xe',
      v.tong, v.da_thu, v.debt_approved;
  end if;

  update public.dv_tickets set
    status = 'DA_GIAO',
    qc_by = coalesce(qc_by, me.uid), qc_by_name = coalesce(nullif(qc_by_name,''), me.name),
    qc_at = coalesce(qc_at, now()), qc_note = coalesce(nullif(qc_note,''), coalesce(p_note,'')),
    delivered_at = now(), delivered_by = me.uid, delivered_by_name = me.name
  where id = p_id;

  perform public._dv_log('ticket', t.code, 'hoan_tat', null, null, p_note);
  perform public._notify_discord(jsonb_build_object('content',
    concat('✅ **Hoàn tất phiếu DV** ', t.code, ' · ', t.customer_name, ' (', t.customer_phone, ') · tổng ',
      to_char(v.tong, 'FM999,999,999,999'), 'đ (thu ', to_char(v.da_thu, 'FM999,999,999,999'),
      'đ, công nợ ', to_char(v.debt_approved, 'FM999,999,999,999'), 'đ) · ', me.name)));
end $$;

-- ===================== 6) TRA CỨU XE ĐÃ BÁN THEO SỐ KHUNG =====================
-- Dung cho o "So khung (xe Minh Ky ban)" — tra ra ten xe, ngay ban, khach
create or replace function public.fn_tra_xe_da_ban(p_frame text)
returns table (
  frame_number text, vehicle_id text, ten_xe text, mau text, hang text,
  status text, location_code text, sale_code text, sale_date date,
  customer_name text, customer_phone text
) language sql stable security definer set search_path = public as $$
  select u.frame_number, u.vehicle_id,
         coalesce(v.name, u.vehicle_id), coalesce(v.color,''), coalesce(v.brand,''),
         u.status, u.location_code,
         coalesce(u.sale_code,''), o.sale_date, coalesce(o.customer_name,''), coalesce(o.customer_phone,'')
  from public.vehicle_units u
  left join public.vehicles v on v.id = u.vehicle_id
  left join public.sales_orders o on o.code = u.sale_code
  where u.frame_number ilike '%' || p_frame || '%'
  order by (u.status = 'DA_BAN') desc, u.frame_number
  limit 10
$$;
