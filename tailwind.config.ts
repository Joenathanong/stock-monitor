import type { Config } from 'tailwindcss';

/** IEG Design System v3.0 (INV IEG/design-ocs.md) — semua warna lewat token CSS. */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="evening"]'],
  theme: {
    screens: { sm: '480px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1600px' },
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)', surface: 'var(--bg-surface)', 'surface-alt': 'var(--bg-surface-alt)', sunken: 'var(--bg-sunken)',
        hover: 'var(--bg-hover)', selected: 'var(--bg-selected)',
        ink: 'var(--ink)', label: 'var(--ink-label)', muted: 'var(--ink-muted)',
        primary: { DEFAULT: 'var(--primary)', hover: 'var(--primary-hover)', subtle: 'var(--primary-subtle)', 'subtle-fg': 'var(--primary-subtle-fg)', solid: 'var(--primary-solid)' },
        positive: 'var(--positive)', critical: 'var(--critical)', negative: 'var(--negative)', informative: 'var(--informative)', neutral: 'var(--neutral)',
        violet: 'var(--accent-violet)', pink: 'var(--accent-pink)',
        c1: 'var(--c1)', c2: 'var(--c2)', c3: 'var(--c3)', c4: 'var(--c4)', c5: 'var(--c5)', c6: 'var(--c6)',
      },
      borderColor: { DEFAULT: 'var(--border)', subtle: 'var(--border-subtle)', strong: 'var(--border-strong)' },
      borderRadius: { card: '12px', control: '8px' },
      boxShadow: { e0: 'var(--shadow-0)', e1: 'var(--shadow-1)', e2: 'var(--shadow-2)' },
      zIndex: { sticky: '10', topbar: '30', sidebar: '40', backdrop: '50', drawer: '60', modal: '70', toast: '80', tooltip: '90' },
    },
  },
  plugins: [],
} satisfies Config;
