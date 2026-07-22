export const CUSTOMER_TYPES = ["Khách lẻ", "Khách buôn", "Khách CBNV", "Khách cũ", "Đối tác", "O2O"];
export const CUSTOMER_SOURCES = ["Khách vãng lai", "Tự tìm kiếm", "Facebook/Tiktok", "Zalo", "Khách cũ giới thiệu", "ĐL bán buôn", "Công ty giao", "Telesale", "Khác"];
export const PAYMENT_METHODS = ["Chuyển khoản", "Tiền mặt", "Cả CK và TM", "Trả góp"];
export const DOC_STATUSES = ["Đủ hồ sơ", "Thiếu CCCD", "Thiếu địa chỉ", "Đang làm đăng ký", "Đã xong đăng ký", "Không làm đăng ký"];
export const ADJUST_REASONS = ["Kiểm kê lệch", "Nhập sai mã xe", "Nhập sai màu", "Sai vị trí kho", "Xe hỏng", "Xe trưng bày", "Xe giữ cho khách", "Lý do khác"];
export const ROLES = { CEO: "CEO / BGĐ", MANAGER: "Quản lý cửa hàng", SALES: "Sales", ADMIN: "Admin / Kế toán / Kho" };

export const NAV_GROUPS = [
  { items: [{ href: "/dashboard", label: "Tổng quan", icon: "▦", roles: ["CEO", "MANAGER", "ADMIN"] }] },
  {
    label: "BÁN HÀNG", icon: "₫",
    items: [
      { href: "/don-ban", label: "Đơn bán", icon: "≡", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dat-coc", label: "Đặt cọc / Giữ xe", icon: "🔒", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
    ],
  },
  {
    label: "THU CHI & QUỸ", icon: "💰",
    items: [
      { href: "/thu-chi", label: "Sổ quỹ", icon: "💰", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/doi-soat", label: "Đối soát cuối ngày", icon: "▣", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "KHO & HÀNG HÓA", icon: "⌂",
    items: [
      { href: "/nhap-hang", label: "Nhập hàng", icon: "⇩", roles: ["CEO", "ADMIN"] },
      { href: "/tra-cuu", label: "Tra cứu tồn", icon: "⌕", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dieu-chuyen", label: "Điều chuyển", icon: "⇄", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/dieu-chinh", label: "Điều chỉnh tồn", icon: "±", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/kiem-ke", label: "Kiểm kê", icon: "☑", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/quet-gom", label: "Quét gom số khung", icon: "📷", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/ton-tong-hop", label: "Bảng tồn tổng hợp", icon: "▦", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "DỮ LIỆU", icon: "◈",
    items: [
      { href: "/lai-thu", label: "Khách lái thử", icon: "🛵", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/lich-su", label: "Lịch sử giao dịch", icon: "≡", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/khach-hang", label: "Khách hàng", icon: "☺", roles: ["CEO", "MANAGER", "SALES", "ADMIN"] },
      { href: "/danh-muc-xe", label: "Danh mục xe", icon: "◈", roles: ["CEO", "ADMIN"] },
      { href: "/nha-cung-cap", label: "Nhà cung cấp", icon: "⛟", roles: ["CEO", "ADMIN"] },
      { href: "/kho", label: "Kho / Cửa hàng", icon: "⌂", roles: ["CEO", "ADMIN"] },
    ],
  },
  {
    label: "CÔNG VIỆC", icon: "✓",
    items: [
      { href: "/cong-viec", label: "Việc của tôi", icon: "☑", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
      { href: "/cong-viec/doi-nhom", label: "Việc đội nhóm", icon: "◫", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-viec/giao-viec", label: "Giao việc", icon: "✎", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/cong-viec/quan-tri", label: "Mẫu & Lặp lại", icon: "⚙", roles: ["CEO", "MANAGER", "ADMIN"] },
    ],
  },
  {
    label: "DỊCH VỤ", icon: "🔧",
    items: [
      { href: "/dich-vu", label: "Phiếu dịch vụ", icon: "🔧", roles: ["CEO", "MANAGER", "SALES", "ADMIN", "TECHNICIAN"] },
    ],
  },
  {
    label: "QUẢN TRỊ", icon: "⚙",
    items: [
      { href: "/lai-gop", label: "Lãi gộp & Công nợ", icon: "◫", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/bao-cao", label: "Báo cáo", icon: "▤", roles: ["CEO", "MANAGER", "ADMIN"] },
      { href: "/nguoi-dung", label: "Người dùng", icon: "◉", roles: ["CEO"] },
      { href: "/cai-dat", label: "Cài đặt", icon: "⚙", roles: ["CEO", "ADMIN"] },
    ],
  },
];
export const NAV = NAV_GROUPS.flatMap((g) => g.items);
