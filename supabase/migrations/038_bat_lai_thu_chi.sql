-- ============================================================
-- Migration 038 — BẬT LẠI MODULE THU-CHI trong app kho
-- Bang/ham tu 012 van con nguyen; 016 chi go cron + bo khoi
-- thanh toan khoi ban hang. File nay:
--  A) Nang quyen: dung phan quyen dong (them 3 quyen thu_chi_*)
--  B) NOI TU DONG: don ban / dich vu / cong no / coc -> sinh phieu thu
--  C) View doi soat: tien mat vs chuyen khoan theo ngay/diem
--  D) Bao cao quy qua Discord (goi tay, khong bat cron lai)
-- Chay SAU 037. Chay lai nhieu lan van an toan.
-- ============================================================

-- ===================== A) QUYEN =====================
insert into public.role_perms (role, perm, allowed) values
  ('SALES','thu_chi_xem',false),  ('TECHNICIAN','thu_chi_xem',false), ('MANAGER','thu_chi_xem',true),  ('ADMIN','thu_chi_xem',true),  ('CEO','thu_chi_xem',true),
  ('SALES','thu_chi_ghi',false),  ('TECHNICIAN','thu_chi_ghi',false), ('MANAGER','thu_chi_ghi',true),  ('ADMIN','thu_chi_ghi',true),  ('CEO','thu_chi_ghi',true),
  ('SALES','thu_chi_chot',false), ('TECHNICIAN','thu_chi_chot',false),('MANAGER','thu_chi_chot',false),('ADMIN','thu_chi_chot',true), ('CEO','thu_chi_chot',true)
on conflict (role, perm) do nothing;

-- Ghi thu chi: chuyen sang phan quyen dong (thay guard role cung cua 012)
create or replace function public.fn_ghi_thu_chi(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('thu_chi_ghi') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền ghi thu chi'; end if;
  if coalesce((p->>'amount')::bigint,0) <= 0 then raise exception 'SO_LUONG_SAI: số tiền phải > 0'; end if;
  if not exists (select 1 from public.cash_accounts where id = (p->>'account_id')::bigint and status = 'Hoạt động') then
    raise exception 'KHONG_TIM_THAY: quỹ không tồn tại hoặc đã khóa';
  end if;
  if (p->>'direction') = 'Chi' and public.fn_so_du((p->>'account_id')::bigint) < (p->>'amount')::bigint then
    raise exception 'TON_KHONG_DU: số dư quỹ hiện tại là % đ, không đủ chi', public.fn_so_du((p->>'account_id')::bigint);
  end if;
  v_code := public.fn_gen_code(case when p->>'direction' = 'Thu' then 'PT' else 'PC' end);
  insert into public.cash_txns (code, txn_date, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_code, coalesce(nullif(p->>'txn_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
          (p->>'account_id')::bigint, p->>'direction', (p->>'amount')::bigint,
          coalesce(nullif(p->>'category',''),'Khác'), coalesce(p->>'counterparty',''),
          coalesce(p->>'description',''), coalesce(p->>'ref_doc',''), me.uid, me.name);
  return v_code;
end $$;

create or replace function public.fn_chot_quy(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_date date; v_sys bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('thu_chi_chot') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được chốt quỹ'; end if;
  v_date := coalesce(nullif(p->>'close_date','')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_sys := public.fn_so_du((p->>'account_id')::bigint, v_date);
  insert into public.cash_closings (account_id, close_date, system_balance, actual_balance, diff, note, closed_by, closed_by_name)
  values ((p->>'account_id')::bigint, v_date, v_sys, (p->>'actual_balance')::bigint,
          (p->>'actual_balance')::bigint - v_sys, coalesce(p->>'note',''), me.uid, me.name)
  on conflict (account_id, close_date) do update set
    system_balance = excluded.system_balance, actual_balance = excluded.actual_balance,
    diff = excluded.diff, note = excluded.note, closed_by = excluded.closed_by,
    closed_by_name = excluded.closed_by_name, created_at = now();
end $$;

-- Them/sua quy: dung quyen dong
-- LUU Y: ham cu o 012 tra ve VOID -> phai drop truoc khi doi sang BIGINT
drop function if exists public.fn_them_quy(jsonb);
create or replace function public.fn_them_quy(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare me record; v_id bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('thu_chi_chot') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được tạo/sửa quỹ'; end if;
  v_id := nullif(p->>'id','')::bigint;
  if v_id is null then
    insert into public.cash_accounts (name, type, location_code, bank_info, opening_balance)
    values (p->>'name', coalesce(p->>'type','Tiền mặt'), nullif(p->>'location_code',''),
            coalesce(p->>'bank_info',''), coalesce((p->>'opening_balance')::bigint, 0))
    returning id into v_id;
  else
    update public.cash_accounts set name = p->>'name', type = coalesce(p->>'type', type),
      location_code = nullif(p->>'location_code',''), bank_info = coalesce(p->>'bank_info', bank_info),
      opening_balance = coalesce((p->>'opening_balance')::bigint, opening_balance),
      status = coalesce(p->>'status', status)
    where id = v_id;
  end if;
  return v_id;
end $$;

-- ===================== B) NỐI TỰ ĐỘNG SINH PHIẾU THU =====================
-- Quy mac dinh cho 1 diem: uu tien quy dung location_code, khong co thi lay quy dau tien cung loai
create or replace function public._quy_mac_dinh(p_loc text, p_type text)
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.cash_accounts
  where status = 'Hoạt động' and type = coalesce(p_type, 'Tiền mặt')
  order by (location_code = p_loc) desc nulls last, id
  limit 1
$$;

-- Ghi thu tu dong (dung noi bo — khong kiem tra quyen nguoi dung
-- vi hanh dong goc da duoc kiem tra roi)
create or replace function public._auto_thu(p_loc text, p_method text, p_amount bigint,
  p_category text, p_counterparty text, p_desc text, p_ref text, p_uid uuid, p_uname text)
returns text language plpgsql security definer set search_path = public as $$
declare v_acc bigint; v_code text; v_type text;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  v_type := case when p_method ilike '%mặt%' then 'Tiền mặt' else 'Ngân hàng' end;
  v_acc := public._quy_mac_dinh(p_loc, v_type);
  if v_acc is null then return null; end if;   -- chua tao quy -> bo qua, khong chan nghiep vu
  if exists (select 1 from public.cash_txns where ref_doc = p_ref and direction = 'Thu' and amount = p_amount) then
    return null;  -- chong ghi trung
  end if;
  v_code := public.fn_gen_code('PT');
  insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_code, v_acc, 'Thu', p_amount, coalesce(p_category,'Thu khác'), coalesce(p_counterparty,''),
          coalesce(p_desc,''), coalesce(p_ref,''), p_uid, coalesce(p_uname,'Hệ thống'));
  return v_code;
end $$;

-- 1) Thu tien DICH VU -> tu dong vao quy
create or replace function public.fn_dv_thu_tien(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; t record; v_code text;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('dv_thu_tien') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền thu tiền'; end if;
  select * into t from public.dv_tickets where id = (p->>'ticket_id')::bigint for update;
  if t is null then raise exception 'KHONG_TIM_THAY'; end if;
  if t.status in ('DA_GIAO','HUY') then raise exception 'TRANG_THAI_SAI: phiếu đã đóng'; end if;
  if me.role not in ('ADMIN','CEO') and not exists (
    select 1 from public.dv_collectors c where c.user_id = me.uid and c.location_code = t.location_code and c.active
  ) then
    raise exception 'KHONG_TRONG_DANH_SACH: bạn chưa được chỉ định thu tiền tại điểm % — nhờ CHT gán trong Cài đặt', t.location_code;
  end if;
  if coalesce((p->>'amount')::bigint, 0) <= 0 then raise exception 'THAM_SO_SAI: số tiền phải > 0'; end if;
  if (p->>'method') = 'Tiền mặt' and jsonb_array_length(coalesce(p->'evidence','[]'::jsonb)) = 0 then
    raise exception 'THIEU_ANH: thu tiền mặt bắt buộc chụp ảnh phiếu thu/giao dịch';
  end if;
  v_code := public.fn_next_code('PTDV');
  insert into public.dv_payments (code, ticket_id, method, amount, evidence, collected_by, collected_by_name, note)
  values (v_code, t.id, p->>'method', (p->>'amount')::bigint, coalesce(p->'evidence','[]'::jsonb), me.uid, me.name, coalesce(p->>'note',''));

  -- NOI QUY
  perform public._auto_thu(t.location_code, p->>'method', (p->>'amount')::bigint,
    'Thu dịch vụ', t.customer_name, 'Phiếu DV '||t.code||' — '||v_code, v_code, me.uid, me.name);

  perform public._dv_log('ticket', t.code, 'thu_tien', null, jsonb_build_object('code', v_code, 'method', p->>'method', 'amount', p->>'amount'), '');
  perform public._notify_discord(jsonb_build_object('content',
    '💵 **Thu tiền DV** '||v_code||' · phiếu '||t.code||' · '||(p->>'method')||' '||(p->>'amount')||'đ · '||me.name||' · điểm '||t.location_code));
  return v_code;
end $$;

-- 2) Cap nhat da tra cua DON BAN (thu them cong no) -> tu dong vao quy phan chenh lech
create or replace function public.fn_cap_nhat_da_tra(p_id bigint, p_paid bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record; v_them bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('sua_thanh_toan') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền cập nhật thanh toán'; end if;
  if coalesce(p_paid,0) < 0 then raise exception 'THAM_SO_SAI'; end if;
  select * into o from public.sales_orders where id = p_id for update;
  if o is null then raise exception 'KHONG_TIM_THAY'; end if;
  v_them := p_paid - coalesce(o.paid_amount, 0);
  update public.sales_orders set paid_amount = p_paid,
    note = case when coalesce(p_note,'') = '' then note
           else trim(both ' | ' from coalesce(nullif(note,''),'') || ' | Thu thêm: ' || p_note || ' (' || me.name || ')') end
  where id = p_id;
  if v_them > 0 then
    perform public._auto_thu(o.location_code, coalesce(o.payment_method,'Chuyển khoản'), v_them,
      'Thu công nợ bán xe', o.customer_name, 'Đơn '||o.code||' — thu thêm', o.code||'-TT'||p_paid, me.uid, me.name);
  end if;
end $$;

-- 3) DAT COC -> tu dong vao quy
create or replace function public.fn_dat_coc(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare me record; u record; v_code text; v_cust bigint;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN: bạn không có quyền đặt cọc giữ xe'; end if;
  select * into u from public.vehicle_units where frame_number = p->>'frame_number' for update;
  if u is null then raise exception 'KHONG_TIM_THAY: số khung % không có trên hệ thống', p->>'frame_number'; end if;
  if u.status = 'GIU_CHO' then raise exception 'XE_DANG_GIU: xe này đã được giữ cho khách khác'; end if;
  if u.status <> 'TON_KHO' then raise exception 'XE_KHONG_SAN_SANG: xe đang ở trạng thái %', u.status; end if;
  if coalesce(p->>'customer_name','') = '' or coalesce(p->>'customer_phone','') = '' then
    raise exception 'THIEU_THONG_TIN: cần tên và SĐT khách đặt cọc';
  end if;
  if coalesce(nullif(p->>'hold_until','')::date, null) is null then
    raise exception 'THIEU_THONG_TIN: cần chọn ngày giữ xe đến';
  end if;
  v_cust := nullif(p->>'customer_id','')::bigint;
  if v_cust is null then
    v_cust := public._upsert_customer_from_sale(p->>'customer_name', p->>'customer_phone', '',
      coalesce(p->>'customer_address',''), 'Khách lẻ', 'Đặt cọc', me.uid, me.name);
  end if;
  v_code := public.fn_next_code('COC');
  insert into public.deposits (code, frame_number, vehicle_id, location_code, customer_id,
    customer_name, customer_phone, amount, hold_until, note, created_by, created_by_name)
  values (v_code, u.frame_number, u.vehicle_id, u.location_code, v_cust,
    p->>'customer_name', p->>'customer_phone', coalesce((p->>'amount')::bigint, 0),
    (p->>'hold_until')::date, coalesce(p->>'note',''), me.uid, me.name);
  update public.vehicle_units set status = 'GIU_CHO', updated_at = now() where frame_number = u.frame_number;

  -- NOI QUY: tien coc
  perform public._auto_thu(u.location_code, coalesce(p->>'payment_method','Tiền mặt'),
    coalesce((p->>'amount')::bigint, 0), 'Thu tiền cọc', p->>'customer_name',
    'Cọc giữ xe '||v_code||' · SK '||u.frame_number, v_code, me.uid, me.name);

  perform public._notify_discord(jsonb_build_object('content',
    '🔒 **Giữ xe theo cọc '||v_code||'** · SK '||u.frame_number||' · KH '||(p->>'customer_name')||' ('||(p->>'customer_phone')||
    ') · cọc '||coalesce((p->>'amount')::bigint,0)||'đ · giữ đến '||(p->>'hold_until')||' · '||me.name));
  return v_code;
end $$;

-- ===================== C) VIEW ĐỐI SOÁT =====================
create or replace view public.v_quy_so_du as
select a.id, a.name, a.type, a.location_code, a.status, a.opening_balance,
  a.opening_balance
    + coalesce((select sum(case when t.direction = 'Thu' then t.amount else -t.amount end)
                from public.cash_txns t where t.account_id = a.id), 0) as so_du
from public.cash_accounts a;

create or replace view public.v_thu_chi_ngay as
select txn_date, account_id,
  sum(amount) filter (where direction = 'Thu') as tong_thu,
  sum(amount) filter (where direction = 'Chi') as tong_chi,
  count(*) as so_phieu
from public.cash_txns group by txn_date, account_id;

-- Bao cao quy nhanh qua Discord (goi tay tu giao dien)
create or replace function public.fn_bao_cao_quy_now()
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_msg text := '💰 **Số dư quỹ hiện tại**\n';
begin
  if not public.fn_co_quyen('thu_chi_xem') then raise exception 'KHONG_CO_QUYEN'; end if;
  for r in select * from public.v_quy_so_du where status = 'Hoạt động' order by type, name loop
    v_msg := v_msg || '· ' || r.name || ' (' || r.type || '): **' || to_char(r.so_du, 'FM999,999,999,999') || 'đ**\n';
  end loop;
  perform public._notify_discord(jsonb_build_object('content', v_msg));
end $$;
