module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true,
    jest: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 12
  },
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "Literal[value='Asia/Amman']",
        message: "Hardcoded timezones are strictly forbidden. Import and use getTimezone() from src/utils/timezone.js instead."
      },
      {
        selector: "Literal[value='Africa/Cairo']",
        message: "Hardcoded timezones are strictly forbidden. Import and use getTimezone() from src/utils/timezone.js instead."
      }
    ]
  }
};
