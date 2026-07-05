const fs = require('fs');
const path = require('path');
const babelParser = require('@babel/parser');

const DIRECTORIES_TO_CHECK = [
  'src/jobs',
  'src/workers',
  'src/events/consumers',
  'src/queues'
];

const RLS_MODELS = ['order', 'lead', 'opportunity', 'salesActivity'];

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

function isPrismaBase(node) {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === 'prisma') {
    return true;
  }
  if (node.type === 'MemberExpression') {
    if (node.property && node.property.type === 'Identifier' && node.property.name === 'prisma') {
      return true;
    }
    return isPrismaBase(node.object);
  }
  return false;
}

function getPrismaModelName(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  
  if (node.property && node.property.type === 'Identifier') {
    const propName = node.property.name;
    // Check if the property is one of the RLS models (camelCase or lowercase check)
    const lowerPropName = propName.toLowerCase();
    const isModel = RLS_MODELS.some(model => model.toLowerCase() === lowerPropName);
    
    if (isModel && isPrismaBase(node.object)) {
      return propName;
    }
  }
  return null;
}

const checkFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  
  let ast;
  try {
    ast = babelParser.parse(content, {
      sourceType: 'unambiguous',
      plugins: [
        'objectRestSpread',
        'classProperties',
        'dynamicImport'
      ]
    });
  } catch (err) {
    console.error(`❌ [RLS Linter] Failed to parse ${filePath}: ${err.message}`);
    hasError = true;
    return;
  }

  const errors = [];

  function checkNode(node, insideContext = false) {
    if (!node || typeof node !== 'object') return;

    let currentInside = insideContext;
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee.type === 'Identifier' && (callee.name === 'runAsSystemAdmin' || callee.name === 'runAsBranch')) {
        currentInside = true;
      }
    }

    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const callee = node.callee;
      const modelName = getPrismaModelName(callee.object);
      if (modelName) {
        if (!currentInside) {
          const loc = node.loc ? node.loc.start.line : 'unknown';
          errors.push({ line: loc, model: modelName });
        }
      }
    }

    for (const key in node) {
      if (node.hasOwnProperty(key)) {
        const val = node[key];
        if (Array.isArray(val)) {
          for (const child of val) {
            checkNode(child, currentInside);
          }
        } else if (val && typeof val === 'object') {
          checkNode(val, currentInside);
        }
      }
    }
  }

  checkNode(ast.program);

  if (errors.length > 0) {
    errors.forEach(err => {
      console.error(`❌ [RLS Linter Error] File ${filePath} accesses RLS model '${err.model}' directly at line ${err.line} outside a runAsSystemAdmin or runAsBranch block.`);
    });
    hasError = true;
  }
};

const main = () => {
  const baseDir = path.resolve(__dirname, '..');
  console.log('🔍 Running RLS AST-based Bypass Check...');

  DIRECTORIES_TO_CHECK.forEach(dir => {
    const fullPath = path.join(baseDir, dir);
    const files = walkSync(fullPath);
    files.forEach(checkFile);
  });

  if (hasError) {
    console.error('🚨 AST RLS Check Failed! All RLS-protected queries in background jobs, queues, or consumers must be wrapped inside context helpers.');
    process.exit(1);
  } else {
    console.log('✅ AST RLS Check Passed.');
    process.exit(0);
  }
};

main();
