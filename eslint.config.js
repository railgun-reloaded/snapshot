import railgunEslintConfig from '@railgun-reloaded/eslint-config'

export default [
  {
    ignores: ['scripts/**', 'src/**/*.d.ts', 'test/**/*.d.ts']
  },
  ...railgunEslintConfig(),
]
