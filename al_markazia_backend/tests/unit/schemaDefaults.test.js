const fs = require('fs');
const path = require('path');

test('Branch, Customer and HappyHour timezone defaults match restaurant settings', () => {
  const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const defaults = schema.match(/timezone\s+String\?\s+@default\("([^"]+)"\)/g);
  expect(defaults).not.toBeNull();
  defaults.forEach(d => expect(d).toContain('Asia/Amman'));
});
