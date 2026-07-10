module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 900: "#0F2237", 800: "#132A43", 700: "#1D3550" },
        brand: { DEFAULT: "#1D4FB8", dark: "#173F94" },
        ok: "#129D61", warn: "#D97E00", danger: "#DC2F3E",
      },
      fontFamily: { sans: ["'Be Vietnam Pro'", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
