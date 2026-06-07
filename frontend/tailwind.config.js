/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        neon: {
          green: '#00ff88',
          blue: '#00d4ff',
          red: '#ff4444',
          orange: '#ff8c00',
        },
        dark: {
          900: '#05050a',
          800: '#0a0a13',
          700: '#0f0f1a',
          600: '#13131f',
          500: '#1a1a2e',
          400: '#22223a',
          300: '#2d2d4a',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-neon': 'pulse-neon 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-neon': {
          '0%, 100%': { boxShadow: '0 0 5px #00ff88, 0 0 10px #00ff8840' },
          '50%': { boxShadow: '0 0 20px #00ff88, 0 0 40px #00ff8860' },
        },
        'slide-up': {
          from: { transform: 'translateY(20px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'glow': {
          '0%, 100%': { textShadow: '0 0 10px #00ff88' },
          '50%': { textShadow: '0 0 30px #00ff88, 0 0 60px #00ff8880' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'mesh-1': 'radial-gradient(at 40% 20%, #00ff8810 0px, transparent 50%), radial-gradient(at 80% 0%, #00d4ff10 0px, transparent 50%), radial-gradient(at 0% 50%, #7c3aed10 0px, transparent 50%)',
      },
    },
  },
  plugins: [],
};
