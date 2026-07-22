import "./globals.css";

export const metadata = {
  title: "Minh Kỳ EV — Quản lý tồn kho xe máy điện",
  description: "Hệ thống quản lý xuất nhập tồn xe máy điện VinFast & TAILG — Minh Kỳ Tuyên Quang",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Minh Kỳ EV",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport = {
  themeColor: "#1f6feb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
