import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './**/*.{ts,tsx}',
    '!./node_modules/**',
    '!./dist/**',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      colors: {
        berkeley: {
          blue: '#003262',
          gold: '#FDB515',
          medblue: '#3B7EA1',
          lightgray: '#F2F2F2',
        },
      },
      animation: {
        'slide-in': 'slideIn 0.4s cubic-bezier(0.32, 0.72, 0, 1) forwards',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'card-in': 'cardIn 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0.8' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0.9' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        cardIn: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
