-- ============================================================
-- Migration 110 (1/2): TÁI THIẾT KẾ "Phương thức thanh toán"
-- Gộp 2 việc liên quan chặt:
--   #1 paid_amount TỪ giá trị ghi tay (cộng/trừ thủ công ở ≥4 hàm
--      khác nhau, dễ lệch) SANG giá trị TỰ ĐỘNG TÍNH LẠI bằng trigger
--      mỗi khi sale_payments thay đổi — không thể lệch về mặt kỹ thuật.
--   #2 method TỪ chuỗi tự do (CHECK constraint cứng + so khớp
--      ilike '%mặt%' trong _auto_thu) SANG bảng cấu hình payment_methods
--      thật — thêm phương thức mới chỉ cần thêm 1 dòng, không sửa code.
--
-- ⚠️ ĐÂY LÀ THAY ĐỔI CỐT LÕI CỦA HỆ THỐNG TÀI CHÍNH — đọc kỹ ghi chú
-- từng bước, kiểm tra đối chiếu số liệu cẩn thận trước khi dùng thật.
-- Chạy sau 109. Chạy lại nhiều lần vẫn an toàn (idempotent).
-- ============================================================

-- ---------- A) Bảng cấu hình payment_methods ----------
create table if not exists public.payment_methods (
  code text primary key,               -- dung luon ten hien thi lam code, KHONG doi du lieu cu (Tien mat/Chuyen khoan/Tra gop)
  quy_type text check (quy_type in ('Tiền mặt','Ngân hàng')),  -- NULL = KHONG vao quy ngay (vd Tra gop, cho giai ngan)
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

create or replace function public.fn_luu_phuong_thuc_thanh_toan(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được quản lý phương thức thanh toán'; end if;
  if coalesce(trim(p->>'code'),'') = '' then raise exception 'THIEU_THONG_TIN: nhập tên phương thức'; end if;

  insert into public.payment_methods (code, quy_type, requires_finance_company, is_active, sort_order, note)
  values (trim(p->>'code'), nullif(p->>'quy_type',''), coalesce((p->>'requires_finance_company')::boolean, false),
    coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort_order')::int, 99), coalesce(p->>'note',''))
  on conflict (code) do update set
    quy_type = excluded.quy_type, requires_finance_company = excluded.requires_finance_company,
    is_active = excluded.is_active, sort_order = excluded.sort_order, note = excluded.note;
end $$;

-- ---------- B) sale_payments: gan lai method thanh FK + cot refunded_amount ----------
alter table public.sale_payments drop constraint if exists sale_payments_method_check;
alter table public.sale_payments add constraint sale_payments_method_fkey
  foreign key (method) references public.payment_methods(code);

alter table public.sale_payments add column if not exists refunded_amount bigint not null default 0;
alter table public.sale_payments drop constraint if exists sale_payments_refunded_amount_check;
alter table public.sale_payments add constraint sale_payments_refunded_amount_check
  check (refunded_amount >= 0 and refunded_amount <= amount);

-- ---------- C) sales_orders: them coc_applied (tach rieng phan tien coc da gap vao don) ----------
alter table public.sales_orders add column if not exists coc_applied bigint not null default 0;

-- Dam bao cot deposits.sale_code ton tai (tu migration 095 "Coc lien ket
-- Don ban") — them lai o day cho chac, phong truong hop 095 chua tung
-- duoc chay truoc do (khong phu thuoc am vao thu tu migration khac).
alter table public.deposits add column if not exists sale_code text references public.sales_orders(code);

-- Backfill coc_applied TU DUNG NGUON GOC THAT (deposits.sale_code, da lien ket boi
-- trigger migration 095 neu da chay — neu deposits.sale_code toan NULL vi 095 chua
-- tung chay/chua co du lieu cu, coc_applied se ra 0, khong sao, khong lam sai gi ca).
update public.sales_orders o set coc_applied = coalesce((
  select sum(d.amount) from public.deposits d where d.sale_code = o.code and d.status = 'DA_BAN'
), 0)
where coc_applied = 0;  -- chi backfill neu chua tung set (an toan khi chay lai)

-- ---------- D) TRIGGER: paid_amount TU DONG TINH LAI moi khi sale_payments thay doi ----------
-- Day la "invariant" — paid_amount KHONG THE lech khoi thuc te ve mat ky thuat nua.
create or replace function public._trg_recalc_paid_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_tong bigint;
begin
  v_code := coalesce(NEW.sale_code, OLD.sale_code);
  select coalesce(sum(amount - refunded_amount), 0) into v_tong
  from public.sale_payments where sale_code = v_code and not is_reversed;

  update public.sales_orders o set paid_amount = o.coc_applied + v_tong where o.code = v_code;
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_recalc_paid_amount on public.sale_payments;
create trigger trg_recalc_paid_amount
after insert or update or delete on public.sale_payments
for each row execute procedure public._trg_recalc_paid_amount();

-- ---------- E) DOI CHIEU 1 LAN: chay lai cong thuc cho TOAN BO don hien co ----------
-- Tu sua dung ngay moi lech lich su tich luy tu truoc (vd tu bug Tra gop cu).
update public.sales_orders o set paid_amount = o.coc_applied + coalesce((
  select sum(sp.amount - sp.refunded_amount) from public.sale_payments sp
  where sp.sale_code = o.code and not sp.is_reversed
), 0);
