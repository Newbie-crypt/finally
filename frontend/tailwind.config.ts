import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Terminal surfaces — layered, never pure black.
        terminal: {
          void: '#0d1117', // page background
          deep: '#11161f', // panel background
          panel: '#161c26', // raised panel / header
          rail: '#1a1a2e', // chat rail, accent surface
          line: '#232b38', // hairline borders
          edge: '#2e3949', // hover / active borders
        },
        // Brand accents from PLAN.md §2.
        accent: '#ecad0a', // yellow — selection, focus, brand mark
        primary: '#209dd7', // blue — links, buy affordances, chart line
        secondary: '#753991', // purple — submit buttons
        // Market semantics.
        up: '#26d07c',
        down: '#f0506e',
        flat: '#7d8899',
        muted: '#8b98ab',
        dim: '#5d6b7f',
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['10px', { lineHeight: '14px', letterSpacing: '0.08em' }],
        tick: ['11px', { lineHeight: '15px' }],
        data: ['13px', { lineHeight: '18px' }],
      },
      keyframes: {
        'flash-up': {
          '0%': { backgroundColor: 'rgba(38, 208, 124, 0.28)' },
          '100%': { backgroundColor: 'rgba(38, 208, 124, 0)' },
        },
        'flash-down': {
          '0%': { backgroundColor: 'rgba(240, 80, 110, 0.28)' },
          '100%': { backgroundColor: 'rgba(240, 80, 110, 0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'flash-up': 'flash-up 500ms ease-out forwards',
        'flash-down': 'flash-down 500ms ease-out forwards',
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
