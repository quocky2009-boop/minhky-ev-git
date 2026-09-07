-- ============================================================
-- Migration: fn_sua_so_khung — sửa số khung của 1 xe trong đơn nhập
-- (VD: nhập lô 50 xe, phát hiện 1 xe bị gõ sai số khung, không cần
-- Hủy/Xóa hẳn/Nhập lại cả lô).
--
-- AN TOÀN: chỉ cho sửa khi xe đang ở status = TON_KHO (chưa
-- bán/chuyển/điều chỉnh/giữ cọc) — vì `deposits.frame_number` là
-- Foreign Key THẬT trỏ tới vehicle_units(frame_number), nếu xe đã
-- từng có phiếu cọc, Postgres sẽ tự chặn UPDATE khóa chính (FK
-- violation) — kiểm tra tay trước để báo lỗi rõ ràng hơn thay vì lỗi
-- Postgres khó hiểu.
-- Chạy 1 lần, độc lập.
-- ============================================================

-- Da co 1 ban CU cua ham nay voi TEN THAM SO khac (vd p_old thay vi
-- p_frame_cu) — Postgres KHONG cho CREATE OR REPLACE doi ten tham so
-- du cung kieu/cung so luong, phai DROP truoc.
drop function if exists public.fn_sua_so_khung(text, text);

create or replace function public.fn_sua_so_khung(p_frame_cu text, p_frame_moi text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; u record;
begin
  select * into me from public.fn_me_mkt();
  if me.uid is null then raise exception 'CHUA_DANG_NHAP'; end if;
  if not public.fn_co_quyen('sua_kho_nhap') then
    raise exception 'KHONG_CO_QUYEN: bạn không có quyền sửa số khung';
  end if;

  if coalesce(trim(p_frame_moi),'') = '' then raise exception 'THIEU_THONG_TIN: nhập số khung mới'; end if;
  if trim(p_frame_cu) = trim(p_frame_moi) then raise exception 'TRUNG_SO_KHUNG: số khung mới trùng số khung cũ'; end if;

  select * into u from public.vehicle_units where frame_number = trim(p_frame_cu) for update;
  if u is null then raise exception 'KHONG_TIM_THAY: không tìm thấy số khung %', p_frame_cu; end if;
  if u.status <> 'TON_KHO' then
    raise exception 'KHONG_THE_SUA: xe đang ở trạng thái % (không phải Tồn kho) — chỉ sửa số khung được khi xe còn nguyên tồn kho, chưa bán/chuyển/giữ cọc', u.status;
  end if;

  if exists (select 1 from public.vehicle_units where frame_number = trim(p_frame_moi)) then
    raise exception 'DA_TON_TAI: số khung mới % đã tồn tại trên hệ thống', p_frame_moi;
  end if;
  if exists (select 1 from public.deposits where frame_number = trim(p_frame_cu)) then
    raise exception 'DANG_CO_COC: số khung này đã từng có phiếu cọc liên kết, không thể đổi số khung — liên hệ xử lý thủ công';
  end if;

  update public.vehicle_units set frame_number = trim(p_frame_moi), updated_at = now()
  where frame_number = trim(p_frame_cu);

  -- Giu nguyen dong log Nhap hang cu (khong sua noi dung goc), chi noi
  -- them chu thich de biet da sua so khung, dung nguyen tac "lich su
  -- khong xoa/sua, sai sot xu ly bang ghi chu bo sung".
  update public.inventory_txns set
    note = concat(note, ' · [ĐÃ SỬA SỐ KHUNG: ', p_frame_cu, ' → ', p_frame_moi, ' bởi ', me.name, ' lúc ', to_char(now(),'DD/MM/YYYY HH24:MI'), ']')
  where doc_code = u.import_doc and txn_type = 'Nhập hàng' and note like concat('%', p_frame_cu, '%');

  perform public._notify_discord(jsonb_build_object('content',
    concat('✏️ **Sửa số khung** đơn ', u.import_doc, ' — ', p_frame_cu, ' → ', p_frame_moi, ' · ', me.name)));
end $$;
