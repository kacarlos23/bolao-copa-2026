/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: '#101418',
        pitch: '#0b2f26',
        grass: '#1f8f5f',
        gold: '#e0b74a',
        coral: '#d95f4f',
        panel: '#161b22',
      },
    },
  },
  plugins: [],
};
