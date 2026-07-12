@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

body { @apply bg-[#F3F5F8] text-[#1B2733] font-sans; }

.card { @apply bg-white rounded-2xl border border-[#E6EAEF] p-5; }
.inp { @apply w-full px-3 py-2.5 rounded-xl border border-[#D5DBE3] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand; }
.lbl { @apply block text-xs font-semibold text-[#5A6572] mb-1.5; }
.btn { @apply px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-primary { @apply btn bg-brand text-white hover:bg-brand-dark; }
.btn-ok { @apply btn bg-ok text-white hover:brightness-105; }
.btn-ghost { @apply btn bg-[#EEF1F4] text-[#3B4552] hover:bg-[#E3E7EC]; }
.btn-danger { @apply btn bg-[#FDE8EA] text-[#B01E2C]; }
.th { @apply text-left px-3 py-2.5 text-[11px] font-bold text-[#5A6572] border-b-2 border-[#E6EAEF] uppercase tracking-wide whitespace-nowrap; }
.td { @apply px-3 py-2.5 text-[13.5px] border-b border-[#EEF1F4] align-top; }
