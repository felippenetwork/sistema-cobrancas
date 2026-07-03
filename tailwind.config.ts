import type { Config } from 'tailwindcss'

// Mapeia os tokens do design-system (globals.css :root) para classes Tailwind.
// Nomes seguem a convenção shadcn/ui para integração futura sem mudança de classes.
// REGRA: toda cor no código sai daqui — sem hex solto em JSX/TSX.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background:  'var(--bg)',
        foreground:  'var(--text)',
        card: {
          DEFAULT:    'var(--surface)',
          foreground: 'var(--text)',
        },
        primary: {
          DEFAULT:    'var(--primary)',
          foreground: 'var(--primary-fg)',
        },
        muted: {
          DEFAULT:    'var(--surface-2)',
          foreground: 'var(--text-muted)',
        },
        accent: {
          DEFAULT:    'var(--surface-2)',
          foreground: 'var(--text)',
        },
        destructive: {
          DEFAULT:    'var(--danger)',
          foreground: '#ffffff',
          bg:         'var(--danger-bg)',
          border:     'var(--danger-border)',
        },
        success: {
          DEFAULT:    'var(--success)',
          bg:         'var(--success-bg)',
          foreground: '#ffffff',
          border:     'var(--success-border)',
        },
        warning: {
          DEFAULT:    'var(--warning)',
          bg:         'var(--warning-bg)',
          foreground: '#ffffff',
          border:     'var(--warning-border)',
        },
        border: 'var(--border)',
        input:  'var(--surface-2)',
        ring:   'var(--primary)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
