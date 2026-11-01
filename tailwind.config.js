/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        sidebar: 'var(--sidebar)',
        surface: 'var(--surface)',
        elevated: 'var(--surface-elevated)',
        border: 'var(--border)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
      },
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        menu: 'var(--radius-menu)',
        modal: 'var(--radius-modal)',
      },
    },
  },
  plugins: [],
}

