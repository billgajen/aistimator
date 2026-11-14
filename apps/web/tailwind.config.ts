import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // The one radius scale (system.md, Shape). It replaces Tailwind's own, so
    // no other step exists: there is no bare `rounded` and no `rounded-warm-*`.
    borderRadius: {
      none: '0',
      xs: '2px', // the tucked corner of a chat bubble
      sm: '4px', // tags, checkboxes, small marks
      md: '6px', // small controls
      lg: '8px', // buttons, fields
      xl: '12px', // cards
      '2xl': '16px', // panels, large cards
      '3xl': '20px', // the document sheet, the request form
      full: '9999px',
    },
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
        // `line` is the soft edge of a box in that colour's tint. Do not write
        // an opacity modifier (border-danger/30) on these tokens: they are
        // plain var() strings, so Tailwind writes no CSS for it.
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          light: 'var(--color-secondary-light)',
          line: 'var(--color-secondary-line)',
        },
        tertiary: {
          DEFAULT: 'var(--color-tertiary)',
          light: 'var(--color-tertiary-light)',
          line: 'var(--color-tertiary-line)',
        },
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        // The edge of a field or an outlined control (3:1 on paper). Kept
        // before `danger` so an error border still wins over it.
        field: 'var(--color-field)',
        danger: {
          DEFAULT: 'var(--color-danger)',
          light: 'var(--color-danger-light)',
          line: 'var(--color-danger-line)',
        },
        ink: 'var(--color-ink)',
        'ink-deep': 'var(--color-ink-deep)',
        mist: 'var(--color-mist)',
        mint: 'var(--color-mint)',
        butter: 'var(--color-butter)',
        tape: 'var(--color-tape)',
        // Accent (system.md): the fill, its tint, text on the tint, text on the fill
        accent: {
          DEFAULT: 'var(--color-accent)',
          tint: 'var(--color-accent-tint)',
          line: 'var(--color-accent-line)',
          ink: 'var(--color-accent-ink)',
        },
        'on-accent': 'var(--color-on-accent)',
        focus: 'var(--color-focus)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      // Bigger display sizes for marketing headlines (system.md, Type).
      // Everything else uses Tailwind's own steps, text-xs to text-4xl.
      fontSize: {
        'display-sm': ['2.5rem', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        'display-md': ['3.25rem', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
        'display-lg': ['4rem', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
        'display-xl': ['5rem', { lineHeight: '1', letterSpacing: '-0.035em' }],
      },
      maxWidth: {
        // The one container for marketing pages (72rem, the same as max-w-6xl)
        container: '72rem',
      },
      transitionDuration: {
        'hover-in': 'var(--motion-hover-in)',
        'hover-out': 'var(--motion-hover-out)',
        press: 'var(--motion-press)',
        menu: 'var(--motion-menu)',
        enter: 'var(--motion-enter)',
      },
      transitionTimingFunction: {
        move: 'var(--ease-move)',
        enter: 'var(--ease-enter)',
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
        'fade-in-up': 'fade-in-up var(--motion-enter) var(--ease-enter)',
      },
    },
  },
  plugins: [],
}

export default config
