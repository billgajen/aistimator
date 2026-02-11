import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          light: 'var(--color-primary-light)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          light: 'var(--color-secondary-light)',
        },
        tertiary: {
          DEFAULT: 'var(--color-tertiary)',
          light: 'var(--color-tertiary-light)',
        },
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        danger: {
          DEFAULT: 'var(--color-danger)',
          light: 'var(--color-danger-light)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        'warm-lg': '0.5rem',
        'warm-xl': '0.625rem',
        'warm-2xl': '0.75rem',
      },
      boxShadow: {
        'warm': '0 0 0 1px var(--color-border)',
        'warm-md': '0 1px 3px rgba(0, 0, 0, 0.04), 0 0 0 1px var(--color-border)',
        'warm-lg': '0 2px 8px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--color-border)',
        'warm-hover': '0 4px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--color-border)',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
