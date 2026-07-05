const fs = require('fs');
const path = require('path');

const DIRECTORIES_TO_CHECK = [
  'src/jobs',
  'src/workers',
  'src/events/consumers',
  'src/queues'
];

const RLS_MODELS = ['Order', 'Lead', 'Opportunity', 'SalesActivity'];

// Simple regex to catch direct prisma.[model] usage
// This is a static analysis heuristic.
const prismaUsageRegex = new RegExp(`prisma\\.\\s*(${RLS_MODELS.join('|')})`, 'gi');

let hasError = false;

const walkSync = (dir, filelist = []) => {
  if (!fs.existsSync(dir)) return filelist;
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      filelist = walkSync(dirFile, filelist);
    } else {
      if (file.endsWith('.js')) {
        filelist.push(dirFile);
      }
    }
  });
  return filelist;
};

const checkFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    if (line.match(prismaUsageRegex)) {
      const hasContextImport = content.includes('require(\'../utils/context\')') || content.includes('require(\'../../utils/context\')') || content.includes('require("../utils/context")') || content.includes('require("../../utils/context")');
      if (!hasContextImport) {
        console.error(`❌ [RLS Linter Error] File ${filePath} accesses an RLS model directly at line ${index + 1} but does not import context helpers.`);
        console.error(`   Line: ${line.trim()}`);
        hasError = true;
      }
    }
  });
};

const main = () => {
  const baseDir = path.resolve(__dirname, '..');
  console.log('🔍 Running RLS Static Bypass Check...');

  DIRECTORIES_TO_CHECK.forEach(dir => {
    const fullPath = path.join(baseDir, dir);
    const files = walkSync(fullPath);
    files.forEach(checkFile);
  });

  if (hasError) {
    console.error('🚨 Static RLS Check Failed! Background jobs must use runAsSystemAdmin or runAsBranch to access RLS models.');
    process.exit(1);
  } else {
    console.log('✅ Static RLS Check Passed.');
    process.exit(0);
  }
};

main();
