module.exports = [
  ...require('@railgun-reloaded/eslint-config')(),
  {
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param-description': 'off',
    },
  },
]
