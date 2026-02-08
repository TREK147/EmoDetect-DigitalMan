/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      portrait: { raw: '(orientation: portrait)' },
      landscape: { raw: '(orientation: landscape)' },
    },
    extend: {
      colors: {
        primary: {
          50: 'var(--primary-50, #eff6ff)',
          100: 'var(--primary-100, #dbeafe)',
          500: 'var(--primary-500, #3b82f6)',
          600: 'var(--primary-600, #2563eb)',
        },
      },
      safeArea: {
        top: 'env(safe-area-inset-top)',
        bottom: 'env(safe-area-inset-bottom)',
        left: 'env(safe-area-inset-left)',
        right: 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
}
