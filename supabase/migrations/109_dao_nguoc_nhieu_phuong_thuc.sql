-- ============================================================
-- Migration 109: Nâng cấp fn_dao_nguoc_khoan_thu — cho phép đảo
-- ngược 1 khoản thu THÀNH NHIỀU phương thức (trước đây chỉ đổi được
-- sang đúng 1 phương thức khác). Thêm bảng audit riêng ghi rõ
-- BEFORE (phương thức+số tiền cũ) / AFTER (mảng phương thức+số tiền
-- mới) — tách biệt khỏi ghi chú rải rác trong cash_txns để tra soát
-- dễ hơn.
-- Chạy sau 108. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create table if not exists public.sale_payment_reversals (
  id bigserial primary key,
  sale_code text not null,
  old_payment_id bigint not null,
  old_method text not null,
  old_amount bigint not null,
  new_payments jsonb not null,   -- [{method, amount, finance_company, new_payment_id}]
  reason text not null default '',
  by_id uuid references public.profiles(id),
  by_name text default '',
  at timestamptz not null default now()
);
create index if not exists spr_sale_idx on public.sale_payment_reversals (sale_code);

alter table public.sale_payment_reversals enable row level security;
drop policy if exists "read_spr" on public.sale_payment_reversals;
create policy "read_spr" on public.sale_payment_reversals for select to authenticated using (true);

-- Xoa ham cu (doi tham so tu p_new_method/p_new_amount sang p_new_payments jsonb)
drop function if exists public.fn_dao_nguoc_khoan_thu(bigint, text, text, bigint, text, bigint);

create or replace function public.fn_dao_nguoc_khoan_thu(
  p_payment_id bigint,
  p_ly_do text,
  p_new_payments jsonb,          -- [{method, amount, finance_company}]
  p_old_account_id bigint default null  -- chi can neu du lieu cu thieu cash_txn_code
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; sp record; o record; v_old_acc bigint; v_pc_code text;
  ln jsonb; v_new_id bigint; v_new_code text; v_new_ids jsonb := '[]'::jsonb;
  v_tong_moi bigint := 0;
begin
  select * into me from public.fn_me();
  if me.role not in ('ADMIN','CEO') then raise exception 'KHONG_CO_QUYEN: chỉ Admin/BGĐ được đảo ngược khoản thu'; end if;
  if coalesce(trim(p_ly_do),'') = '' then raise exception 'THIEU_THONG_TIN: nhập lý do đảo ngược'; end if;
  if jsonb_array_length(coalesce(p_new_payments,'[]'::jsonb)) = 0 then
    raise exception 'THIEU_THONG_TIN: cần ít nhất 1 phương thức thanh toán mới';
  end if;

  select * into sp from public.sale_payments where id = p_payment_id for update;
  if sp is null then raise exception 'KHONG_TIM_THAY: khoản thu không tồn tại'; end if;
  if sp.is_reversed then raise exception 'DA_DAO_NGUOC: khoản thu này đã được đảo ngược trước đó'; end if;

  select * into o from public.sales_orders where code = sp.sale_code for update;
  if o is null then raise exception 'KHONG_TIM_THAY: đơn bán không tồn tại'; end if;

  -- Xac dinh quy cu can hoan lai (chi ap dung neu khoan cu da THAT SU vao quy)
  if sp.status = 'Đã thu' then
    v_old_acc := coalesce(
      (select account_id from public.cash_txns where code = sp.cash_txn_code),
      sp.account_id, p_old_account_id);
    if v_old_acc is null then
      raise exception 'THIEU_QUY: không xác định được quỹ gốc của khoản thu cũ, phải chọn thủ công (p_old_account_id)';
    end if;
    v_pc_code := public.fn_gen_code('PC');
    insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
    values (v_pc_code, v_old_acc, 'Chi', sp.amount, 'Đảo ngược thu sai', o.customer_name,
      concat('Đảo ngược khoản thu #', sp.id, ' (', sp.method, ') đơn ', o.code, '. Lý do: ', p_ly_do), o.code, me.uid, me.name);
  end if;

  update public.sale_payments set
    is_reversed = true, reversed_at = now(), reversed_by = me.uid, reversed_by_name = me.name, reverse_reason = p_ly_do
  where id = p_payment_id;

  -- Tao TUNG khoan thu moi theo mang p_new_payments
  for ln in select jsonb_array_elements(p_new_payments) loop
    if coalesce((ln->>'amount')::bigint, 0) <= 0 then continue; end if;
    v_tong_moi := v_tong_moi + (ln->>'amount')::bigint;

    if ln->>'method' = 'Trả góp' then
      insert into public.sale_payments (sale_code, method, amount, note, status, finance_company, created_by, created_by_name)
      values (o.code, 'Trả góp', (ln->>'amount')::bigint, concat('Sửa lại từ khoản thu #', p_payment_id), 'Chờ giải ngân',
        coalesce(ln->>'finance_company',''), me.uid, me.name)
      returning id into v_new_id;
    else
      insert into public.sale_payments (sale_code, method, amount, note, status, created_by, created_by_name)
      values (o.code, ln->>'method', (ln->>'amount')::bigint, concat('Sửa lại từ khoản thu #', p_payment_id), 'Đã thu', me.uid, me.name)
      returning id into v_new_id;

      v_new_code := public._auto_thu(o.location_code, ln->>'method', (ln->>'amount')::bigint, 'Bán xe', o.customer_name,
        concat('Sửa lại thu - Đơn ', o.code), concat(o.code, '-sua-', v_new_id), me.uid, me.name);
      if v_new_code is not null then
        update public.sale_payments set
          cash_txn_code = v_new_code,
          account_id = (select account_id from public.cash_txns where code = v_new_code)
        where id = v_new_id;
      end if;
    end if;

    v_new_ids := v_new_ids || jsonb_build_array(jsonb_build_object(
      'method', ln->>'method', 'amount', (ln->>'amount')::bigint,
      'finance_company', ln->>'finance_company', 'new_payment_id', v_new_id));
  end loop;

  if v_tong_moi <= 0 then raise exception 'SO_TIEN_SAI: tổng số tiền các phương thức mới phải > 0'; end if;

  update public.sales_orders set
    paid_amount = greatest(coalesce(paid_amount,0) - sp.amount + v_tong_moi, 0)
  where code = o.code;

  -- Ghi audit truy vet BEFORE/AFTER day du
  insert into public.sale_payment_reversals (sale_code, old_payment_id, old_method, old_amount, new_payments, reason, by_id, by_name)
  values (o.code, p_payment_id, sp.method, sp.amount, v_new_ids, p_ly_do, me.uid, me.name);

  perform public._notify_discord(jsonb_build_object('content',
    concat('🔄 **Đảo ngược khoản thu** đơn ', o.code, ' — từ ', sp.method, ' ', sp.amount,
      'đ TÁCH THÀNH ', jsonb_array_length(v_new_ids), ' phương thức (tổng ', v_tong_moi, 'đ) · lý do: ', p_ly_do, ' · bởi ', me.name)));

  return jsonb_build_object('old_payment_id', p_payment_id, 'new_payments', v_new_ids);
end $$;
