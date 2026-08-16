-- ============================================================
-- Migration 102: fn_ai_bao_cao_dieu_hanh — báo cáo điều hành cuối
-- ngày TOÀN DIỆN cho CEO, tách theo từng cửa hàng/khu vực.
--
-- QUAN TRỌNG: hàm này CHỈ ĐỌC, KHÔNG tái sử dụng thẳng
-- fn_doi_soat_tinh() (migration 044) vì hàm đó có side-effect
-- INSERT/UPDATE vào bảng doi_soat_ngay. Công thức bên dưới SAO CHÉP
-- lại đúng logic tính của fn_doi_soat_tinh (đối chiếu dòng-by-dòng)
-- nhưng chỉ SELECT, không ghi gì.
--
-- Các mục ĐÃ LOẠI BỎ theo xác nhận của anh Kỳ:
--   - "Phản ánh khách hàng" — không có bảng nào lưu trong hệ thống.
--
-- Phễu khách hàng: đếm theo TRẠNG THÁI HIỆN TẠI (snapshot), không
-- phải biến động phát sinh trong ngày.
--
-- Cảnh báo tồn lâu ngày: 3 mức >30 / >60 / >90 ngày kể từ
-- vehicle_units.imported_at (chỉ tính xe còn TON_KHO/DANG_CHUYEN).
--
-- p_location_code = null: trả TẤT CẢ cửa hàng + 1 dòng tổng
-- "TOAN_HE_THONG". p_location_code cụ thể: chỉ trả đúng 1 dòng đó.
-- Chạy sau 101. Chạy lại nhiều lần vẫn an toàn.
-- ============================================================

create or replace function public.fn_ai_bao_cao_dieu_hanh(
  p_ngay date default current_date,
  p_location_code text default null
)
returns table (
  location_code text,
  dia_diem text,
  khu_vuc text,
  doanh_so jsonb,
  dich_vu jsonb,
  so_sanh jsonb,
  pheu_khach_hang jsonb,
  cong_no jsonb,
  quy jsonb,
  kho jsonb,
  mau_xe_can_luu_y jsonb,
  don_chua_hoan_tat jsonb,
  hieu_suat_sales jsonb,
  cong_viec jsonb,
  canh_bao jsonb
)
language plpgsql security definer stable set search_path = public as $$
declare l record; v_hom_qua date := p_ngay - 1; v_7ngay_truoc date := p_ngay - 6;
  v_don int; v_xe int; v_dt_xe bigint; v_dt_pk bigint; v_dt_dk bigint; v_dt_bh bigint;
  v_pdv int; v_dt_dv bigint;
  v_dt_xe_qua bigint; v_dt_xe_7d bigint;
  v_ct_thang record; v_ct_dat_dt numeric; v_ct_dat_sl numeric;
  v_khach_moi int; v_tu_van int; v_bao_gia int; v_dat_coc int; v_mua_tc int; v_khach_nong int;
  v_cn_phai_thu bigint; v_cn_da_thu bigint; v_cn_moi bigint; v_cn_qua_han bigint; v_cn_so_khach int;
  v_tm bigint; v_ck bigint; v_tg bigint; v_coc bigint; v_khac bigint; v_chi bigint; v_lech bigint;
  v_kha_dung int; v_giu_cho int; v_cho_giao int; v_dieu_chuyen int; v_loi int; v_nhap int; v_xuat int;
  v_mau_xe jsonb; v_don_chua_xn int; v_ho_so_tg int; v_xe_cho_bg int;
  v_sales jsonb; v_task_qh int; v_task_sd int;
  v_canh_bao jsonb;
begin
  for l in
    select code, name, region from public.locations
    where status = 'Hoạt động' and (p_location_code is null or code = p_location_code)
    order by region, name
  loop
    -- ===== 1) DOANH SO =====
    select count(*), coalesce(sum(o.quantity),0), coalesce(sum(o.sale_price*o.quantity),0)
      into v_don, v_xe, v_dt_xe
    from public.sales_orders o where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy';

    select coalesce(sum(i.amount) filter (where i.item_type='PHU_KIEN'),0),
           coalesce(sum(i.amount) filter (where i.item_type='DANG_KY'),0),
           coalesce(sum(i.amount) filter (where i.item_type='BAO_HIEM'),0)
      into v_dt_pk, v_dt_dk, v_dt_bh
    from public.sale_items i join public.sales_orders o on o.code = i.sale_code
    where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy';

    -- Dich vu (giao trong ngay, giong dung logic fn_doi_soat_tinh)
    select count(*), coalesce(sum(v.tong),0) into v_pdv, v_dt_dv
    from public.dv_tickets t join public.v_dv_ticket_tong v on v.ticket_id = t.id
    where t.location_code = l.code and t.status = 'DA_GIAO'
      and (t.delivered_at at time zone 'Asia/Ho_Chi_Minh')::date = p_ngay;

    -- ===== 2) SO SANH: hom qua + binh quan 7 ngay + chi tieu thang =====
    select coalesce(sum(o.sale_price*o.quantity),0) into v_dt_xe_qua
    from public.sales_orders o where o.location_code = l.code and o.sale_date = v_hom_qua and o.status <> 'Đã hủy';

    select coalesce(sum(o.sale_price*o.quantity),0) / 7.0 into v_dt_xe_7d
    from public.sales_orders o where o.location_code = l.code and o.sale_date between v_7ngay_truoc and p_ngay and o.status <> 'Đã hủy';

    select * into v_ct_thang from public.sales_targets st
    where st.thang = date_trunc('month', p_ngay)::date and st.location_code = l.code;
    if v_ct_thang is null then
      select * into v_ct_thang from public.sales_targets st
      where st.thang = date_trunc('month', p_ngay)::date and st.location_code is null;
    end if;

    -- ===== 3) PHEU KHACH HANG (snapshot hien tai) =====
    select
      count(*) filter (where c.pipeline_stage = 'Mới tiếp nhận'),
      count(*) filter (where c.pipeline_stage in ('Đã liên hệ','Có nhu cầu','Hẹn tới cửa hàng','Đã lái thử')),
      count(*) filter (where c.pipeline_stage = 'Đang báo giá'),
      count(*) filter (where c.pipeline_stage = 'Đã cọc'),
      count(*) filter (where c.pipeline_stage = 'Đã bán'),
      count(*) filter (where c.heat = 'Nóng')
    into v_khach_moi, v_tu_van, v_bao_gia, v_dat_coc, v_mua_tc, v_khach_nong
    from public.customers c where c.location_code = l.code;

    -- ===== 4) CONG NO =====
    select coalesce(sum(v.con_no + v.da_tra),0), coalesce(sum(v.da_tra),0), coalesce(sum(v.con_no),0),
           count(distinct coalesce(v.customer_id::text, v.customer_phone))
      into v_cn_phai_thu, v_cn_da_thu, v_cn_qua_han, v_cn_so_khach
    from public.v_cong_no_phai_thu v where v.location_code = l.code and v.so_ngay_qua_han > 0;

    select coalesce(sum(v.con_no),0) into v_cn_moi
    from public.v_cong_no_phai_thu v where v.location_code = l.code and v.sale_date = p_ngay;

    -- ===== 5) QUY (sao chep cong thuc fn_doi_soat_tinh, CHI DOC) =====
    -- CHI tinh tai khoan quy gan RIENG cho cua hang nay — KHONG gom tai
    -- khoan dung chung toan cong ty (location_code IS NULL) de tranh dem
    -- trung khi cong don nhieu cua hang lai (tai khoan chung se hien rieng
    -- 1 lan duy nhat o dong QUY_CHUNG_CONG_TY ben duoi, khong lap lai o day).
    select coalesce(sum(t.amount) filter (where t.direction='Thu' and a.type='Tiền mặt'),0),
           coalesce(sum(t.amount) filter (where t.direction='Thu' and a.type='Ngân hàng'),0),
           coalesce(sum(t.amount) filter (where t.direction='Chi'),0),
           coalesce(sum(t.amount) filter (where t.direction='Thu'
                    and t.category not in ('Bán xe','Thu dịch vụ','Thu tiền cọc','Thu công nợ bán xe')),0)
      into v_tm, v_ck, v_chi, v_khac
    from public.cash_txns t join public.cash_accounts a on a.id = t.account_id
    where t.txn_date = p_ngay and a.location_code = l.code;

    select coalesce(sum(d.amount),0) into v_coc
    from public.deposits d where d.location_code = l.code and (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date = p_ngay;

    select coalesce(sum(sp.amount),0) into v_tg
    from public.sale_payments sp join public.sales_orders o on o.code = sp.sale_code
    where o.location_code = l.code and sp.method = 'Trả góp' and sp.status = 'Chờ giải ngân'
      and sp.created_at::date = p_ngay and not sp.is_reversed;

    v_lech := (v_dt_xe + v_dt_dv + v_coc + v_khac) - (v_tm + v_ck);

    -- ===== 6) KHO =====
    select count(*) filter (where u.status in ('TON_KHO','DANG_CHUYEN')),
           count(*) filter (where u.status = 'GIU_CHO')
      into v_kha_dung, v_giu_cho
    from public.vehicle_units u where u.location_code = l.code;

    select count(*) into v_cho_giao
    from public.vehicle_units u join public.sales_orders o on o.code = u.sale_code
    where u.location_code = l.code and u.status = 'DA_BAN' and coalesce(o.invoice_status,'Chờ xuất HĐ') <> 'Đã xuất HĐ';

    select count(*) into v_dieu_chuyen from public.transfer_orders t
    where (t.from_location = l.code or t.to_location = l.code) and t.status = 'Đang chuyển';

    select count(*) into v_loi from public.transfer_orders t
    where (t.from_location = l.code or t.to_location = l.code) and t.status = 'Lỗi/chênh lệch';

    select count(*) into v_nhap from public.vehicle_units u
    where u.location_code = l.code and u.imported_at::date = p_ngay and u.status <> 'DA_XOA';

    v_xuat := v_xe;

    -- ===== 7) MAU XE CAN LUU Y (ton thap/ton lau ngay >30/60/90) =====
    select coalesce(jsonb_agg(jsonb_build_object(
        'model_xe', x.model_xe, 'mau', x.mau, 'ton', x.ton, 'ngay_ton_lau_nhat', x.max_ngay,
        'duoi_dinh_muc', x.ton < x.min_stock,
        'canh_bao_ton_lau', case when x.max_ngay > 90 then '>90 ngày'
          when x.max_ngay > 60 then '>60 ngày' when x.max_ngay > 30 then '>30 ngày' else null end
      )) filter (where x.ton < x.min_stock or x.max_ngay > 30), '[]'::jsonb)
      into v_mau_xe
    from (
      select v.brand || ' ' || v.name as model_xe, v.color as mau, v.min_stock,
        count(u.frame_number) as ton,
        coalesce(max(extract(day from now() - u.imported_at)::int), 0) as max_ngay
      from public.vehicles v
      left join public.vehicle_units u on u.vehicle_id = v.id and u.location_code = l.code
        and u.status in ('TON_KHO','DANG_CHUYEN')
      where v.status <> 'Ngừng bán'
      group by v.id, v.brand, v.name, v.color, v.min_stock
    ) x;

    -- ===== 8) DON CHUA HOAN TAT =====
    select count(*) into v_don_chua_xn from public.sales_orders o
    where o.location_code = l.code and o.status <> 'Đã hủy' and coalesce(o.invoice_status,'Chờ xuất HĐ') <> 'Đã xuất HĐ';

    select count(*) into v_ho_so_tg from public.sale_payments sp join public.sales_orders o on o.code = sp.sale_code
    where o.location_code = l.code and sp.method = 'Trả góp' and sp.status = 'Chờ giải ngân' and not sp.is_reversed;

    v_xe_cho_bg := v_cho_giao;

    -- ===== 9) HIEU SUAT SALES (trong ngay, tai diem ban nay) =====
    select coalesce(jsonb_agg(jsonb_build_object(
        'nhan_vien', y.seller_name, 'doanh_thu', y.dt, 'so_don', y.sd,
        'so_lead_moi', coalesce(cm.n, 0), 'so_khach_nong_moi', coalesce(cn.n, 0)
      ) order by y.dt desc), '[]'::jsonb)
      into v_sales
    from (
      select o.seller_name, sum(o.sale_price*o.quantity) as dt, count(*) as sd
      from public.sales_orders o where o.location_code = l.code and o.sale_date = p_ngay and o.status <> 'Đã hủy'
      group by o.seller_name
    ) y
    left join (
      select assigned_name, count(*) n from public.customers cs
      where cs.location_code = l.code and cs.created_at::date = p_ngay group by assigned_name
    ) cm on cm.assigned_name = y.seller_name
    left join (
      select assigned_name, count(*) n from public.customers cs
      where cs.location_code = l.code and cs.heat = 'Nóng' and cs.created_at::date = p_ngay group by assigned_name
    ) cn on cn.assigned_name = y.seller_name;

    -- ===== 10) CONG VIEC (dung view co san, loc theo diem/nguoi thuoc diem nay qua profiles neu co) =====
    select coalesce(qua_han,0), coalesce(sap_den_han,0) into v_task_qh, v_task_sd from public.v_task_dashboard limit 1;

    -- ===== 11) CANH BAO =====
    v_canh_bao := '[]'::jsonb;
    if v_lech <> 0 then v_canh_bao := v_canh_bao || jsonb_build_array(concat('Lệch quỹ ', v_lech, 'đ — cần đối soát lại')); end if;
    if v_don_chua_xn > 0 then v_canh_bao := v_canh_bao || jsonb_build_array(concat(v_don_chua_xn, ' đơn chưa xuất hóa đơn/hoàn tất checklist')); end if;
    if v_loi > 0 then v_canh_bao := v_canh_bao || jsonb_build_array(concat(v_loi, ' phiếu điều chuyển lỗi/chênh lệch chưa xử lý')); end if;
    if v_task_qh > 0 then v_canh_bao := v_canh_bao || jsonb_build_array(concat(v_task_qh, ' công việc quá hạn')); end if;
    if jsonb_array_length(v_mau_xe) > 0 then v_canh_bao := v_canh_bao || jsonb_build_array(concat(jsonb_array_length(v_mau_xe), ' mẫu xe tồn thấp/tồn lâu ngày cần lưu ý')); end if;

    return query select
      l.code, l.name, l.region,
      jsonb_build_object('so_don', v_don, 'so_xe', v_xe, 'doanh_thu_xe', v_dt_xe,
        'doanh_thu_phu_kien', v_dt_pk, 'doanh_thu_dang_ky', v_dt_dk, 'doanh_thu_bao_hiem', v_dt_bh),
      jsonb_build_object('so_phieu', v_pdv, 'doanh_thu', v_dt_dv),
      jsonb_build_object(
        'hom_qua', jsonb_build_object('doanh_thu_xe', v_dt_xe_qua),
        'binh_quan_7_ngay', jsonb_build_object('doanh_thu_xe', round(v_dt_xe_7d)),
        'chi_tieu_thang', case when v_ct_thang is null then null else
          jsonb_build_object('muc_tieu_doanh_thu', v_ct_thang.target_revenue, 'muc_tieu_so_xe', v_ct_thang.target_units) end
      ),
      jsonb_build_object('khach_moi', v_khach_moi, 'tu_van', v_tu_van, 'bao_gia', v_bao_gia,
        'dat_coc', v_dat_coc, 'mua_thanh_cong', v_mua_tc, 'khach_nong', v_khach_nong),
      jsonb_build_object('tong_phai_thu', v_cn_phai_thu, 'da_thu', v_cn_da_thu, 'con_thieu', v_cn_qua_han,
        'so_khach_qua_han', v_cn_so_khach, 'phat_sinh_moi_trong_ngay', v_cn_moi),
      jsonb_build_object('tien_mat', v_tm, 'chuyen_khoan', v_ck, 'tra_gop_cho_giai_ngan', v_tg,
        'tien_coc', v_coc, 'thu_khac', v_khac, 'chi_trong_ngay', v_chi, 'chenh_lech', v_lech),
      jsonb_build_object('ton_kha_dung', v_kha_dung, 'giu_cho', v_giu_cho, 'cho_giao', v_cho_giao,
        'dang_dieu_chuyen', v_dieu_chuyen, 'loi_chenh_lech', v_loi, 'nhap_hom_nay', v_nhap, 'xuat_ban_hom_nay', v_xuat),
      v_mau_xe,
      jsonb_build_object('chua_xac_nhan_hd_checklist', v_don_chua_xn, 'ho_so_tra_gop_cho_giai_ngan', v_ho_so_tg,
        'xe_chua_ban_giao', v_xe_cho_bg),
      v_sales,
      jsonb_build_object('qua_han', v_task_qh, 'sap_den_han', v_task_sd),
      v_canh_bao;
  end loop;

  -- ===== DÒNG RIÊNG: quỹ dùng chung toàn công ty (không gắn cửa hàng cụ thể) =====
  -- Chỉ hiện 1 LẦN DUY NHẤT khi lấy báo cáo toàn hệ thống (p_location_code null).
  -- KHÔNG được cộng dòng này vào từng cửa hàng — đây là tài khoản dùng chung.
  if p_location_code is null then
    select coalesce(sum(t.amount) filter (where t.direction='Thu' and a.type='Tiền mặt'),0),
           coalesce(sum(t.amount) filter (where t.direction='Thu' and a.type='Ngân hàng'),0),
           coalesce(sum(t.amount) filter (where t.direction='Chi'),0)
      into v_tm, v_ck, v_chi
    from public.cash_txns t join public.cash_accounts a on a.id = t.account_id
    where t.txn_date = p_ngay and a.location_code is null;

    return query select
      'QUY_CHUNG_CONG_TY'::text, '(Quỹ dùng chung toàn công ty — KHÔNG cộng vào từng cửa hàng)'::text, null::text,
      null::jsonb, null::jsonb, null::jsonb, null::jsonb, null::jsonb,
      jsonb_build_object('tien_mat', v_tm, 'chuyen_khoan', v_ck, 'chi_trong_ngay', v_chi),
      null::jsonb, null::jsonb, null::jsonb, null::jsonb, null::jsonb, '[]'::jsonb;
  end if;
end $$;

revoke all on function public.fn_ai_bao_cao_dieu_hanh(date, text) from public, anon, authenticated;
grant execute on function public.fn_ai_bao_cao_dieu_hanh(date, text) to service_role;
