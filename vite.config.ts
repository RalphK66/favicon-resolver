import { defineConfig } from 'vite-plus'
import { voidPlugin } from 'void'

export default defineConfig({
  plugins: [voidPlugin()],
  fmt: {
    ignorePatterns: ['.void/**', 'dist/**', 'node_modules/**', 'pnpm-lock.yaml', '**/*.md'],
    arrowParens: 'avoid',
    printWidth: 100,
    semi: false,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'es5',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
