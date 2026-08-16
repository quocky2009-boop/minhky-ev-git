-- ============================================================
-- Migration 114: PHÁT HIỆN BUG NGHIÊM TRỌNG — fn_tra_no_ncc dùng
-- nhầm hàm _auto_thu (direction luôn hardcode 'Thu') để ghi khoản
-- TRẢ TIỀN CHO NCC — đúng ra đây là khoản CHI (tiền ra khỏi công ty)
-- nhưng bị ghi thành THU (tiền vào) → mỗi lần trả nợ NCC, quỹ bị
-- CỘNG NHẦM thay vì TRỪ RA.
--
-- Đồng thời bổ sung: cho phép chọn tài khoản cụ thể khi trả NCC
-- (không có bảng "suppliers" có cấu trúc/gắn hãng nào trong hệ thống
-- — NCC chỉ là tên tự do — nên KHÔNG thể tự suy ra đúng pháp nhân,
-- phải để nhân viên TỰ CHỌN tay, hiển thị kèm tên pháp nhân để dễ
-- nhận biết đúng tài khoản).
-- Chạy sau 113b. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- A) Ham moi _auto_chi (giong _auto_thu nhung direction='Chi') ----------
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
    return null;  -- chong ghi trung
  end if;
  v_code := public.fn_gen_code('PC');
  insert into public.cash_txns (code, account_id, direction, amount, category, counterparty, description, ref_doc, created_by, created_by_name)
  values (v_code, v_acc, 'Chi', p_amount, coalesce(p_category,'Chi khác'), coalesce(p_counterparty,''),
          coalesce(p_desc,''), coalesce(p_ref,''), p_uid, coalesce(p_uname,'Hệ thống'));
  return v_code;
end $$;

-- ---------- B) Sua fn_tra_no_ncc: dung dung _auto_chi, nhan account_id ----------
create or replace function public.fn_tra_no_ncc(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; d record; v_amount bigint;
begin
  select * into me from public.fn_me();
  if me.role not in ('CEO','MANAGER','ADMIN') then raise exception 'KHONG_CO_QUYEN'; end if;
  select * into d from public.supplier_debts where id = (p->>'debt_id')::bigint for update;
  if d is null then raise exception 'KHONG_TIM_THAY'; end if;
  v_amount := (p->>'amount')::bigint;
  if v_amount <= 0 then raise exception 'THIEU_THONG_TIN: số tiền phải > 0'; end if;
  if d.da_tra + v_amount > d.tong_tien then
    raise exception 'VUOT_SO_NO: tổng trả (%) vượt quá số nợ (%)', d.da_tra + v_amount, d.tong_tien;
  end if;
  insert into public.supplier_debt_payments (debt_id, amount, paid_at, method, note, created_by, created_by_name)
  values (d.id, v_amount, coalesce(nullif(p->>'paid_at','')::date, current_date),
    coalesce(nullif(p->>'method',''),'Chuyển khoản'), coalesce(p->>'note',''), me.uid, me.name);
  update public.supplier_debts set
    da_tra = da_tra + v_amount,
    status = case when da_tra + v_amount >= tong_tien then 'Đã thanh toán' else 'Còn nợ' end,
    updated_at = now()
  where id = d.id;
  -- Sinh phieu CHI vao quy (SUA: dung _auto_chi thay vi _auto_thu, nhan dung account_id)
  perform public._auto_chi(d.location_code, coalesce(nullif(p->>'method',''),'Chuyển khoản'),
    v_amount, 'Chi trả NCC', d.supplier,
    concat('Đơn nhập ', d.import_doc), concat('NO-', d.code, '-', v_amount), me.uid, me.name,
    nullif(p->>'account_id','')::bigint);
end $$;

-- ---------- C) SUA DU LIEU LICH SU: cac ban ghi da bi ghi NHAM thanh Thu ----------
-- Day la loi PHAN MEM (khong phai quyet dinh nghiep vu cua nguoi dung),
-- sua truc tiep direction cho dung ban chat that su cua giao dich.
update public.cash_txns
set direction = 'Chi',
    description = concat(description, ' · [ĐÃ SỬA: bản ghi này trước đó bị hệ thống ghi NHẦM thành Thu do lỗi phần mềm — migration 114 tự động sửa lại thành Chi cho đúng bản chất]')
where category = 'Chi trả NCC' and direction = 'Thu';
