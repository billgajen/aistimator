import type { Config } from 'tailwindcss'

/** A colour token as Tailwind reads it: the RGB triple from globals.css, with the alpha a class may ask for */
const token = (name: string) => `rgb(var(--color-${name}-rgb) / <alpha-value>)`

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
      // T-172: every colour token is an RGB triple with an alpha slot, so a class can carry an opacity modifier
      // (bg-ink/40, ring-primary/30). They were plain var() strings, for which Tailwind writes no CSS when a
      // modifier is present. The triples live beside the hex values in globals.css.
      colors: {
        background: token('background'),
        surface: token('surface'),
        'text-primary': token('text-primary'),
        'text-secondary': token('text-secondary'),
        'text-muted': token('text-muted'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          light: token('primary-light'),
        },
        // Readable text on primary surfaces; white unless a business's own
        // colour overrides the var (see lib/color.ts).
        'on-primary': 'rgb(var(--color-on-primary-rgb, 255 255 255) / <alpha-value>)',
        // `line` is the soft edge of a box in that colour's tint.
        secondary: {
          DEFAULT: token('secondary'),
          light: token('secondary-light'),
          line: token('secondary-line'),
        },
        tertiary: {
          DEFAULT: token('tertiary'),
          light: token('tertiary-light'),
          line: token('tertiary-line'),
        },
        border: token('border'),
        'border-strong': token('border-strong'),
        // The edge of a field or an outlined control (3:1 on paper). Kept
        // before `danger` so an error border still wins over it.
        field: token('field'),
        danger: {
          DEFAULT: token('danger'),
          light: token('danger-light'),
          line: token('danger-line'),
        },
        ink: token('ink'),
        'ink-deep': token('ink-deep'),
        mist: token('mist'),
        mint: token('mint'),
        butter: token('butter'),
        tape: token('tape'),
        // Accent (system.md): the strong yellow, and the dark text and edge on it.
        // There is no tint: a pale yellow would read as butter. Do not write an
        // opacity modifier on it (a unit test fails on one).
        accent: token('accent'),
        'on-accent': token('on-accent'),
        // The focus ring's colour changes with what it sits on (globals.css), so it stays a plain variable.
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
