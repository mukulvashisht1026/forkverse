import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { MONGODB_URI: 'mongodb://localhost:27017/?directConnection=true' },
  },
});
