import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@expo\/vector-icons(?:\/Ionicons)?$/,
        replacement: fileURLToPath(new URL('./src/test/vector-icons.tsx', import.meta.url)),
      },
      { find: 'react-native', replacement: 'react-native-web' },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
