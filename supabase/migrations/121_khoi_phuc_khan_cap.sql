-- ============================================================
-- Migration 121 (KHẨN CẤP): Khôi phục hoàn toàn _auto_thu, _auto_chi,
-- fn_huy_coc — 3 hàm này đã bị XÓA MẤT sau khi chạy migration 120,
-- vì 120 giả định bản MỚI (110b/113a/113b/114/115b) đã tồn tại rồi
-- mới xóa bản CŨ đi — nhưng thực tế các migration đó CHƯA TỪNG được
-- chạy, nên sau khi xóa bản cũ, KHÔNG CÒN BẢN NÀO CẢ.
--
-- Đây là lỗi của em — xin lỗi vì đã gây gián đoạn bán hàng thật.
--
-- Để tránh lặp lại lỗi domino (thiếu bảng/cột nền tảng gây lỗi tiếp),
-- migration này TỰ KIỂM TRA VÀ TẠO ĐỦ mọi thứ cần thiết theo đúng thứ
-- tự, dùng "IF NOT EXISTS"/"CREATE OR REPLACE" nên CHẠY AN TOÀN dù
-- một số phần bên dưới đã từng được tạo trước đó hay chưa.
-- Chạy NGAY, không cần chạy các migration 110-115 riêng lẻ nữa (file
-- này đã gộp đủ phần thiết yếu để hồi phục nghiệp vụ Bán hàng/Cọc/NCC).
-- ============================================================

-- ---------- BƯỚC 1: Đảm bảo bảng nền tảng đã có (companies, payment_methods) ----------
create table if not exists public.companies (
  id bigserial primary key,
  name text unique not null,
  note text default '',
  status text not null default 'Hoạt động'
);
insert into public.companies (name) values
  ('Công ty TNHH Ngân Thái Sơn'), ('Công ty TNHH Minh Kỳ')
on conflict (name) do nothing;

create table if not exists public.payment_methods (
  code text primary key,
  quy_type text check (quy_type in ('Tiền mặt','Ngân hàng')),
  requires_finance_company boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  note text default ''
);
insert into public.payment_methods (code, quy_type, requires_finance_company, is_active, sort_order, note) values
  ('Tiền mặt', 'Tiền mặt', false, true, 1, 'Ghi thu ngay vào quỹ tiền mặt'),
  ('Chuyển khoản', 'Ngân hàng', false, true, 2, 'Ghi thu ngay vào quỹ ngân hàng'),
  ('Trả góp', null, true, true, 3, 'KHÔNG vào quỹ ngay — chờ Công ty tài chính giải ngân')
on conflict (code) do update set quy_type = excluded.quy_type, requires_finance_company = excluded.requires_finance_company;

alter table public.payment_methods enable row level security;
drop policy if exists "read_payment_methods" on public.payment_methods;
create policy "read_payment_methods" on public.payment_methods for select to authenticated using (true);

-- ---------- BƯỚC 2: Đảm bảo cột nền tảng đã có ----------
alter table public.brands add column if not exists company_id bigint references public.companies(id);
update public.brands set company_id = (select id from public.companies where name = 'Công ty TNHH Ngân Thái Sơn')
where name ilike '%vinfast%' and company_id is null;
update public.brands set company_id = (select id from public.companies where name = 'Công ty TNHH Minh Kỳ')
where company_id is null;

alter table public.cash_accounts add column if not exists company_id bigint references public.companies(id);
alter table public.sale_payments add column if not exists refunded_amount bigint not null default 0;
alter table public.sale_payments drop constraint if exists sale_payments_refunded_amount_check;
alter table public.sale_payments add constraint sale_payments_refunded_amount_check
  check (refunded_amount >= 0 and refunded_amount <= amount);

-- ---------- BƯỚC 3: _quy_mac_dinh (ưu tiên điểm bán → khu vực → quỹ chung → id nhỏ nhất) ----------
create or replace function public._quy_mac_dinh(p_loc text, p_type text)
returns bigint language sql stable security definer set search_path = public as $$
  select a.id
  from public.cash_accounts a
  left join public.locations l on l.code = p_loc
  where a.status = 'Hoạt động' and a.type = coalesce(p_type, 'Tiền mặt')
  order by
    (a.location_code = p_loc) desc nulls last,
    (a.location_code in (select code from public.locations where region = l.region)) desc nulls last,
    (a.location_code is null) desc,
    a.id
  limit 1
$$;

-- ---------- BƯỚC 4: KHÔI PHỤC _auto_thu (10 tham số, bản đúng duy nhất) ----------
drop function if exists public._auto_thu(text, text, bigint, text, text, text, text, uuid, text);
create or replace function public._auto_thu(p_loc text, p_method text, p_amount bigint,
  p_category text, p_counterparty text, p_desc text, p_ref text, p_uid uuid, p_uname text,
  p_account_id bigint default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_acc bigint; v_code text; v_type text;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  select quy_type into v_type from public.payment_methods where code = p_method;
  if v_type is null then return null; end if;

  if v_type = 'Ngân hàng' then
    if p_account_id is null then
      raise exception 'THIEU_TAI_KHOAN: phương thức "%" bắt buộc chọn đúng tài khoản ngân hàng cụ thể', p_method;
    end if;
    if not exists (select 1 from public.cash_accounts where id = p_account_id and status = 'Hoạt động' and type = 'Ngân hàng') then
      raise exception 'TAI_KHOAN_SAI: tài khoản đã chọn không hợp lệ hoặc đã ngừng hoạt động';
    end if;
    v_acc := p_account_id;
  else
    v_acc := coalesce(p_account_id, public._quy_mac_dinh(p_loc, v_type));
  end if;

  if v_acc is null then return null; end if;
  if exists (select 1 from public.cash_txns where ref_doc = p_ref and direction = 'Thu' and amount = p_amount) then
    return null;
  end if;
  v_code := public.fn_gen_code('PT');
  insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_code, v_acc, 'Thu', p_amount, coalesce(p_category,'Thu khác'), coalesce(p_counterparty,''),
          coalesce(p_desc,''), coalesce(p_ref,''), p_uid, coalesce(p_uname,'Hệ thống'));
  return v_code;
end $$;

-- ---------- BƯỚC 5: KHÔI PHỤC _auto_chi (10 tham số, bản đúng duy nhất) ----------
drop function if exists public._auto_chi(text, text, bigint, text, text, text, text, uuid, text);
create or replace function public._auto_chi(p_loc text, p_method text, p_amount bigint,
  p_category text, p_counterparty text, p_desc text, p_ref text, p_uid uuid, p_uname text,
  p_account_id bigint default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_acc bigint; v_code text; v_type text;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  select quy_type into v_type from public.payment_methods where code = p_method;
  if v_type is null then return null; end if;

  if v_type = 'Ngân hàng' then
    if p_account_id is null then
      raise exception 'THIEU_TAI_KHOAN: phương thức "%" bắt buộc chọn đúng tài khoản ngân hàng chi ra', p_method;
    end if;
    if not exists (select 1 from public.cash_accounts where id = p_account_id and status = 'Hoạt động' and type = 'Ngân hàng') then
      raise exception 'TAI_KHOAN_SAI: tài khoản đã chọn không hợp lệ hoặc đã ngừng hoạt động';
    end if;
    v_acc := p_account_id;
  else
    v_acc := coalesce(p_account_id, public._quy_mac_dinh(p_loc, v_type));
  end if;

  if v_acc is null then return null; end if;
  if exists (select 1 from public.cash_txns where ref_doc = p_ref and direction = 'Chi' and amount = p_amount) then
    return null;
  end if;
  v_code := public.fn_gen_code('PC');
  insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_code, v_acc, 'Chi', p_amount, coalesce(p_category,'Chi khác'), coalesce(p_counterparty,''),
          coalesce(p_desc,''), coalesce(p_ref,''), p_uid, coalesce(p_uname,'Hệ thống'));
  return v_code;
end $$;

-- ---------- BƯỚC 6: KHÔI PHỤC fn_huy_coc (4 tham số, bản đúng duy nhất) ----------
drop function if exists public.fn_huy_coc(bigint, text);
create or replace function public.fn_huy_coc(p_id bigint, p_ly_do text, p_hoan_tien boolean default false, p_account_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare me record; d record; r record; v_daclose boolean; v_code text; v_hoan bigint := 0;
begin
  select * into me from public.fn_me_mkt();
  if not public.fn_co_quyen('xuat_ban') then raise exception 'KHONG_CO_QUYEN'; end if;
  if coalesce(btrim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: nhập lý do hủy giữ xe'; end if;
  select * into d from public.deposits where id = p_id for update;
  if d is null then raise exception 'KHONG_TIM_THAY'; end if;
  if d.status <> 'DANG_GIU' then raise exception 'TRANG_THAI_SAI: phiếu cọc này không còn hiệu lực'; end if;
  update public.deposits set status = 'HUY', cancel_reason = p_ly_do where id = p_id;
  update public.vehicle_units set status = 'TON_KHO', updated_at = now()
  where frame_number = d.frame_number and status = 'GIU_CHO';

  if p_hoan_tien and coalesce(d.amount,0) > 0 then
    for r in select * from public.cash_txns where ref_doc = d.code and direction = 'Thu' loop
      v_daclose := exists (select 1 from public.cash_closings c where c.account_id = r.account_id and c.close_date >= r.txn_date);
      if v_daclose then
        if public.fn_so_du(r.account_id) < r.amount then
          raise exception 'QUY_KHONG_DU: quỹ không đủ số dư để hoàn % đ tiền cọc', r.amount;
        end if;
        v_code := public.fn_gen_code('PC');
        insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
        values (v_code, coalesce(p_account_id, r.account_id), 'Chi', r.amount, 'Chi trả lại tiền cho khách hủy/trả đơn',
          r.counterparty, 'Hoàn cọc '||d.code||' — '||p_ly_do, d.code, me.uid, me.name);
      else
        delete from public.cash_txns where id = r.id;
      end if;
      v_hoan := v_hoan + r.amount;
    end loop;
  end if;

  perform public._notify_discord(jsonb_build_object('content',
    '🔓 **Hủy giữ xe** '||d.code||' · SK '||d.frame_number||' · lý do: '||p_ly_do||' · '||me.name ||
    case when coalesce(d.amount,0) > 0 then
      case when p_hoan_tien then ' · ĐÃ HOÀN '||v_hoan||'đ tiền cọc' else ' · ⚠️ CHƯA HOÀN '||d.amount||'đ tiền cọc — kiểm tra chính sách trước khi bỏ qua' end
    else '' end));
end $$;

-- ---------- BƯỚC 7: XÁC NHẬN CUỐI — chạy tự động, in ra kết quả kiểm tra ----------
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc where proname in ('_auto_thu','_auto_chi','fn_huy_coc');
  if v_count <> 3 then
    raise notice '⚠️ CẢNH BÁO: chỉ tìm thấy % / 3 hàm cần thiết — kiểm tra lại thủ công bằng: select oid::regprocedure from pg_proc where proname in (''_auto_thu'',''_auto_chi'',''fn_huy_coc'');', v_count;
  else
    raise notice '✅ Đã khôi phục đủ 3 hàm _auto_thu, _auto_chi, fn_huy_coc — có thể tạo đơn bán lại bình thường.';
  end if;
end $$;
