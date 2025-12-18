/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        'neo4j': {
          blue: '#018BFF',
          green: '#00D4A4',
        },
      },
    },
  },
  plugins: [],
};
