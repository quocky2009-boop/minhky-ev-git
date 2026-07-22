# TEAM & TASKS — Tài liệu bàn giao

**Hệ thống:** kho.xedienminhky.vn · Minh Kỳ EV
**Ngày bàn giao:** 22/07/2026
**Trạng thái:** MVP hoàn tất — build sạch 34 trang, Discord đã thông (mã 204)

---

## 1. Kết quả kiểm thử tự động

| Hạng mục | Kết quả |
|---|---|
| Production build | ✅ Compiled successfully · 34/34 trang |
| Rà thiếu import JSX | ✅ Sạch |
| Rà React hooks đặt sau early-return | ✅ Sạch |
| 74 hàm RPC gọi từ giao diện | ✅ Đều có định nghĩa trong migration |
| 44 bảng/view giao diện đọc | ✅ Đều tồn tại *(đã sửa 1 lỗi: `suppliers`)* |
| Bẫy đổi kiểu trả về thiếu `drop function` | ✅ Không còn |
| Lệnh xóa storage bằng SQL (Supabase chặn) | ✅ Không còn |
| Gửi Discord | ✅ Mã 204 |

**Lỗi phát hiện & đã sửa trong giai đoạn 6:** trang *Kho phụ tùng* gọi bảng `suppliers` không tồn tại — thực tế nhà cung cấp lưu dạng danh sách trong Cài đặt. Đã sửa: dropdown lấy từ Cài đặt, tên NCC ghi vào ghi chú phiếu nhập.

---

## 2. Thống kê hệ thống hiện tại

- **32 trang** giao diện
- **45 file migration** · **57 bảng** · **177 hàm** database
- **5 vai trò:** CEO · MANAGER (Cửa hàng trưởng) · ADMIN · SALES · TECHNICIAN
- **8 module:** Kho & hàng hóa · Bán hàng · Dịch vụ · Kho phụ tùng · Thu chi & Quỹ · Lãi gộp & Công nợ · Đặt cọc · **Công việc (Team & Tasks)**

---

## 3. Thứ tự chạy migration (nếu dựng lại từ đầu)

Chạy tuần tự theo số. Riêng các file vá phải chạy đúng vị trí:

```
001 → ... → 037
038  (bật lại thu chi)      → 038b (vá fn_them_quy)
039  (gỡ marketing, giữ lái thử)
040  (schema Team & Tasks)
041  (hàm nghiệp vụ task)
042  (Discord outbox + cron)
042b → 042c → 042d  (3 lần vá Discord — chạy đủ cả 3)
```

**Yêu cầu extension:** `pg_cron`, `pg_net`, `pgcrypto` (bật ở Dashboard → Database → Extensions).

---

## 4. Cấu hình sau khi cài

### 4.1 Discord (bắt buộc để có thông báo)
```sql
update app_settings set value = 'URL_WEBHOOK_KENH_CONG_VIEC'
where key = 'discord_webhook_task';
```
Kiểm tra: vào app → **Công việc → Mẫu & Lặp lại → tab Discord → "🔔 Thử gửi tin test"**.
*(Không chạy `fn_task_test_webhook()` bằng SQL Editor — hàm cần biết ai đang đăng nhập, SQL Editor chạy dưới quyền postgres nên sẽ báo CHUA_DANG_NHAP. Đây là hành vi đúng.)*

### 4.2 Ba lịch cron tự động
| Lịch | Thời điểm | Việc |
|---|---|---|
| `task-outbox-1p` | mỗi phút | Đẩy thông báo Discord trong hàng đợi |
| `task-qua-han-1h` | mỗi giờ | Quét việc quá hạn, cảnh báo (không spam) |
| `task-sinh-ky-6h` | 6h sáng VN | Sinh việc lặp lại của ngày |

Kiểm tra: `select jobname, schedule, active from cron.job where jobname like 'task-%';`

### 4.3 Phân quyền
Cài đặt → **Phân quyền theo vai trò** → nhóm **Công việc** (8 quyền). Mặc định:
- SALES/TECHNICIAN: xem việc, tự tạo việc cho mình
- MANAGER: thêm giao việc, duyệt, hủy, quản lý mẫu & lặp lại
- ADMIN/CEO: toàn quyền + báo cáo toàn công ty

---

## 5. CHECKLIST TEST THỦ CÔNG (43 mục theo spec)

Đánh dấu ✅ khi test xong. Test bằng **2 tài khoản**: một SALES, một MANAGER/CEO.

### A. Phân quyền & bảo mật (1–9)
- [ ] 1. Nhân viên chỉ thấy việc được giao cho mình hoặc mình phối hợp
- [ ] 2. Nhân viên **không** thấy việc của người khác trong "Việc của tôi"
- [ ] 3. Nhân viên không có nút đổi người thực hiện
- [ ] 4. Nhân viên không có nút đổi hạn
- [ ] 5. Nhân viên không có nút "Xác nhận hoàn thành"
- [ ] 6. Nhân viên không sửa được thời điểm hoàn thành
- [ ] 7. CHT khu vực A không thấy việc khu vực B *(đăng nhập 2 CHT khác khu vực)*
- [ ] 8. CHT giao việc chỉ chọn được nhân viên trong khu vực mình
- [ ] 9. CEO/ADMIN thấy toàn bộ việc mọi khu vực

### B. Discord (10–15)
- [ ] 10. Giao việc mới → Discord nhận tin **📌 TASK MỚI** (chờ tối đa 1 phút)
- [ ] 11. Webhook không lộ ra giao diện *(kiểm tra: F12 → Network, không thấy URL discord)*
- [ ] 12. Đặt tên việc chứa `@everyone` → Discord **không** mention cả kênh
- [ ] 13. Bấm "Đẩy hàng đợi ngay" 2 lần → không có tin trùng
- [ ] 14. Tắt webhook *(để trống)* → vẫn tạo/duyệt việc bình thường
- [ ] 15. Tab Discord hiển thị đúng số chờ gửi / lỗi / đã gửi

### C. Luồng thực hiện (16–28)
- [ ] 16. Nhân viên bấm "Bắt đầu" → chuyển **Đang thực hiện**
- [ ] 17. Tích checklist → thanh tiến độ % chạy đúng
- [ ] 18. Việc bật "phải tích hết checklist bắt buộc" → chưa tích đủ mà bấm Gửi → **bị chặn**
- [ ] 19. Upload ảnh JPG/PNG → hiện thumbnail, gửi được
- [ ] 20. Upload file PDF/Excel → hiện dạng đính kèm
- [ ] 21. Việc bắt buộc 2 ảnh → gửi 1 ảnh → **bị chặn** kèm thông báo rõ
- [ ] 22. Ảnh đã gửi mở xem được từ tài khoản quản lý
- [ ] 23. Gửi kết quả → chuyển **Chờ xác nhận**
- [ ] 24. Discord ghi **"Chờ xác nhận"**, KHÔNG ghi "đã hoàn thành"
- [ ] 25. Quản lý bấm "Yêu cầu bổ sung" không nhập lý do → **bị chặn**
- [ ] 26. Nhân viên thấy nội dung cần bổ sung, sửa và gửi lại (thành lần 2)
- [ ] 27. Quản lý xác nhận → chuyển **Đã hoàn thành**
- [ ] 28. Discord báo hoàn thành đúng, kèm đúng hạn/trễ hạn

### D. Quá hạn & thời gian (29–32)
- [ ] 29. Tạo việc hạn quá khứ → hiện nhãn đỏ "Quá hạn N giờ/ngày"
- [ ] 30. Việc đã hoàn thành **không** hiện nhãn quá hạn
- [ ] 31. Việc đã hủy **không** hiện nhãn quá hạn
- [ ] 32. **Quan trọng:** gửi kết quả trước hạn, quản lý duyệt sau hạn → vẫn tính **"gửi đúng hạn"**

### E. Lặp lại & hàng loạt (33–38)
- [ ] 33. Tạo lịch lặp hằng ngày → bấm "▶ Sinh việc hôm nay" → có việc mới
- [ ] 34. Bấm "Sinh việc hôm nay" **lần 2** → báo "đã sinh rồi", **không tạo trùng**
- [ ] 35. Sửa một việc trong chuỗi lặp → các kỳ khác không đổi
- [ ] 36. Lịch "ngày cuối tháng" → chỉ sinh đúng ngày cuối tháng
- [ ] 37. Giao việc cho 3 người → tạo **3 việc riêng**, 3 mã khác nhau
- [ ] 38. Mỗi việc hàng loạt có checklist và lịch sử độc lập

### F. Giao diện & dữ liệu (39–43)
- [ ] 39. Trao đổi (bình luận) chỉ người liên quan xem được
- [ ] 40. Mở app trên điện thoại: bảng chuyển thành thẻ, nút bấm đủ lớn
- [ ] 41. Dashboard đếm đúng: quá hạn / hôm nay / chờ duyệt
- [ ] 42. Xuất CSV mở bằng Excel **không lỗi tiếng Việt**
- [ ] 43. Badge đỏ trên menu hiện đúng số việc đang mở / chờ duyệt

---

## 6. Hạn chế còn lại (chưa làm trong MVP)

| Hạng mục | Lý do | Khi nào nên làm |
|---|---|---|
| **Lịch công việc** (xem theo ngày/tuần/tháng) | Chốt C6 — để sau | Khi số việc/tuần > 50 |
| **Mention đích danh trên Discord** | Chốt C3 — cần Discord User ID từng người | Khi muốn nhân viên nhận thông báo riêng |
| **Thông báo trong app** (chuông + danh sách đã đọc) | Chốt C5 — badge menu là đủ | Khi nhân viên phản hồi là hay bỏ sót việc |
| **Phòng ban** | Chốt C1 — công ty tổ chức theo cửa hàng | Khi có phòng ban độc lập với điểm bán |
| Sửa "các kỳ sau" của chuỗi lặp | MVP chỉ sửa từng việc hoặc cả chuỗi | Khi lịch lặp nhiều và hay đổi |
| Kéo thả Kanban đổi trạng thái | Rủi ro bỏ qua quy trình duyệt | Không khuyến nghị |
| Báo cáo tổng hợp Discord cuối ngày | Kiến trúc outbox đã sẵn sàng | Khi đã chạy ổn định 2–4 tuần |

---

## 7. Việc cần làm ngay sau bàn giao

1. **Dán webhook Discord** kênh công việc *(nếu chưa)* và thử tin test từ app
2. **Chạy checklist mục 5** với 2 tài khoản thật
3. **Tạo vài mẫu công việc** riêng của Minh Kỳ *(10 mẫu seed sẵn chỉ là gợi ý — sửa cho khớp thực tế)*
4. **Lập lịch lặp** cho các việc định kỳ: bàn giao ca, báo cáo cuối ngày, kiểm kê cuối tháng
5. Chạy thử **1 tuần với 1 cửa hàng** trước khi mở toàn hệ thống

---

## 8. Xử lý sự cố thường gặp

**Không nhận được thông báo Discord**
1. Kiểm tra hàng đợi: Công việc → Mẫu & Lặp lại → tab Discord (xem số "Gửi lỗi")
2. Bấm "📤 Đẩy hàng đợi ngay" — nếu vẫn lỗi, xem thông báo lỗi hiện bên dưới
3. Kiểm tra cron còn chạy: `select jobname, active from cron.job where jobname like 'task-%';`
4. Kiểm tra phản hồi Discord: `select id, status_code, left(content::text,150) from net._http_response order by id desc limit 5;`

**Việc lặp lại không tự sinh**
- Cron chạy 6h sáng VN. Bấm "▶ Sinh việc hôm nay" để chạy tay.
- Kiểm tra lịch còn `is_active = true` và trong khoảng ngày bắt đầu/kết thúc.

**Nhân viên báo không thấy việc**
- Kiểm tra `profiles.region` của nhân viên có khớp khu vực việc không.
- Kiểm tra quyền `task_xem` trong Cài đặt → Phân quyền.

---

*Tài liệu này sinh tự động từ kết quả kiểm thử ngày 22/07/2026.*
