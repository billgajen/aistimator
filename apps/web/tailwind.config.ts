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
        // Readable text on primary surfaces; white unless a light tenant
        // brand colour overrides the var (see lib/color.ts). RGB triple so
        // opacity modifiers (text-on-primary/60) keep working.
        'on-primary': 'rgb(var(--color-on-primary-rgb, 255 255 255) / <alpha-value>)',
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
        ink: 'var(--color-ink)',
        'ink-deep': 'var(--color-ink-deep)',
        mist: 'var(--color-mist)',
        mint: 'var(--color-mint)',
        butter: 'var(--color-butter)',
        tape: 'var(--color-tape)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        'warm-lg': '0.75rem',
        'warm-xl': '1rem',
        'warm-2xl': '1.25rem',
      },
      boxShadow: {
        'warm': '0 0 0 1px var(--color-border)',
        'warm-md': '0 1px 2px rgba(27, 40, 35, 0.05), 0 2px 8px rgba(27, 40, 35, 0.04), 0 0 0 1px var(--color-border)',
        'warm-lg': '0 2px 4px rgba(27, 40, 35, 0.05), 0 8px 24px rgba(27, 40, 35, 0.07), 0 0 0 1px var(--color-border)',
        'warm-hover': '0 4px 8px rgba(27, 40, 35, 0.06), 0 12px 32px rgba(27, 40, 35, 0.10), 0 0 0 1px var(--color-border-strong)',
        'document': '0 1px 3px rgba(27, 40, 35, 0.06), 0 12px 40px rgba(27, 40, 35, 0.09), 0 32px 80px rgba(27, 40, 35, 0.07)',
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
