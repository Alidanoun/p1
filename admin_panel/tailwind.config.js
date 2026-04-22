/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--bg-app)',
        card: 'var(--bg-card)',
        primary: {
          DEFAULT: '#f97316',
          hover: '#ea580c',
        },
        text: {
          main: 'var(--text-main)',
          muted: 'var(--text-muted)',
        },
        danger: '#ef4444',
        success: '#10b981',
        ['border-subtle']: 'var(--border-subtle)',
      },
      fontFamily: {
        sans: ['Tajawal', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
