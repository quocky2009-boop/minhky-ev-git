-- ============================================================
-- Migration 115 (2/2): Sửa Bug #3 (Hủy Cọc không xử lý tiền) + Bug
-- #2/#6 (Đặt cọc/Giải ngân chưa lọc theo pháp nhân).
--
-- LƯU Ý VỀ BUG #3: "Có hoàn tiền cọc khi hủy hay không" là QUYẾT ĐỊNH
-- KINH DOANH (nhiều nơi giữ cọc theo chính sách khi khách tự ý hủy),
-- KHÔNG phải lỗi kỹ thuật thuần túy — nên em KHÔNG tự động hoàn tiền
-- mặc định. Thay vào đó:
--   - fn_huy_coc: cho phép CEO/Sales chọn CÓ hoàn hay KHÔNG ngay lúc
--     hủy (tham số p_hoan_tien) — không còn "quên" xử lý dòng tiền.
--   - fn_nha_coc_qua_han (tự động khi hết hạn): KHÔNG tự hoàn (đúng
--     thông lệ khách tự bỏ cọc), nhưng gửi cảnh báo Discord rõ ràng
--     liệt kê từng khoản cọc "treo" cần CEO xem xét — không còn im
--     lặng bỏ qua như trước.
-- Chạy sau 115a. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

-- ---------- BUG #3a: fn_huy_coc — cho chon co hoan tien hay khong ----------
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

  -- SUA MOI: neu chon hoan tien, tim dung phieu Thu tien coc goc (ref_doc = ma COC) va hoan dung quy do
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

-- ---------- BUG #3b: fn_nha_coc_qua_han — canh bao ro rang khoan coc treo, KHONG tu hoan ----------
create or replace function public.fn_nha_coc_qua_han()
returns int language plpgsql security definer set search_path = public as $$
declare d record; v_n int := 0; v_canh_bao text := '';
begin
  for d in select * from public.deposits where status = 'DANG_GIU' and hold_until < current_date loop
    update public.deposits set status = 'HET_HAN' where id = d.id;
    update public.vehicle_units set status = 'TON_KHO', updated_at = now()
    where frame_number = d.frame_number and status = 'GIU_CHO';
    v_n := v_n + 1;
    if coalesce(d.amount,0) > 0 then
      v_canh_bao := v_canh_bao || concat(E'\n· ', d.code, ' — SK ', d.frame_number, ' — ', d.amount, 'đ — KH ', d.customer_name);
    end if;
  end loop;
  if v_canh_bao <> '' then
    perform public._notify_discord(jsonb_build_object('content',
      concat('⚠️ **', v_n, ' phiếu cọc hết hạn tự động nhả xe** — CÒN TIỀN CỌC CHƯA XỬ LÝ (chưa hoàn/chưa quyết định giữ):', v_canh_bao,
        E'\n\n➡ Vào Đặt cọc/Giữ xe → xem lại từng phiếu để quyết định hoàn hay giữ theo chính sách.')));
  end if;
  return v_n;
end $$;

-- ---------- BUG #2/#6: dat-coc va giai-ngan chua loc theo phap nhan ----------
-- Voi Dat coc: biet duoc vehicle_id -> brand -> company_id giong het
-- ban hang, nen co the loc dung. Them ham phu tro cho frontend goi.
create or replace function public.fn_phap_nhan_theo_xe(p_frame text)
returns bigint language sql stable security definer set search_path = public as $$
  select b.company_id
  from public.vehicle_units u
  join public.vehicles v on v.id = u.vehicle_id
  join public.brands b on b.name = v.brand
  where u.frame_number = p_frame
  limit 1
$$;

revoke all on function public.fn_phap_nhan_theo_xe(text) from public;
grant execute on function public.fn_phap_nhan_theo_xe(text) to authenticated;
