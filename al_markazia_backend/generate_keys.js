const crypto = require('crypto');
const fs = require('fs');
const { execSync } = require('child_process');

console.log("Generating secure keys...");

// Generate random hex keys
const generateHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const ENCRYPTION_KEY = generateHex(32);
const JWT_SECRET = generateHex(32);
const REFRESH_TOKEN_SECRET = generateHex(32);
const POSTGRES_PASSWORD = generateHex(16);
const REDIS_PASSWORD = generateHex(16);

// Generate RSA 2048 keypair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Get existing decrypted environment
const decryptedStr = execSync('npx @dotenvx/dotenvx get -f .env.production --all').toString();

// The output might have some warnings. Find the JSON part.
const jsonStart = decryptedStr.indexOf('{');
const jsonEnd = decryptedStr.lastIndexOf('}') + 1;
if (jsonStart === -1 || jsonEnd === 0) {
    console.error("Failed to parse dotenvx output");
    process.exit(1);
}

const envVars = JSON.parse(decryptedStr.slice(jsonStart, jsonEnd));

// Update the keys
envVars.ENCRYPTION_KEY = ENCRYPTION_KEY;
envVars.JWT_SECRET = JWT_SECRET;
envVars.REFRESH_TOKEN_SECRET = REFRESH_TOKEN_SECRET;
envVars.JWT_PRIVATE_KEY = privateKey;
envVars.JWT_PUBLIC_KEY = publicKey;
envVars.POSTGRES_PASSWORD = POSTGRES_PASSWORD;
envVars.REDIS_PASSWORD = REDIS_PASSWORD;

// Update URLs with new passwords
envVars.DATABASE_URL = `postgresql://admin:${POSTGRES_PASSWORD}@db:5432/al_markazia_prod_db?schema=public&pool_timeout=30&sslmode=require`;
envVars.REDIS_URL = `redis://:${REDIS_PASSWORD}@redis:6379`;

// We also need to strip out the DOTENV_PUBLIC_KEY so we can encrypt fresh
delete envVars.DOTENV_PUBLIC_KEY_PRODUCTION;

// Write to a plain temp file
let plainEnv = '';
for (const [key, val] of Object.entries(envVars)) {
    // Escape newlines for values like RSA keys
    const safeVal = val.includes('\n') ? `"${val.replace(/\n/g, '\\n')}"` : `"${val}"`;
    plainEnv += `${key}=${safeVal}\n`;
}

fs.writeFileSync('.env.production.plain', plainEnv);

console.log("Plaintext environment written. Encrypting with dotenvx...");
try {
    // Encrypt the plain file into a new .env.production
    // First, remove old files so dotenvx generates fresh keys
    if (fs.existsSync('.env.production')) fs.unlinkSync('.env.production');
    
    // Rename plain to target so dotenvx can encrypt it
    fs.renameSync('.env.production.plain', '.env.production');
    
    // Run encryption
    execSync('npx @dotenvx/dotenvx encrypt -f .env.production', { stdio: 'inherit' });
    console.log("Encryption complete!");
} catch (err) {
    console.error("Error during encryption:", err);
}
