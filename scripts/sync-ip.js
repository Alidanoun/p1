const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * Returns the current local IPv4 address.
 * Priority: Wi-Fi, then Ethernet, then first non-internal IPv4.
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    let fallbackIP = null;

    // 1st Pass: Look for real Wi-Fi or Ethernet
    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        // Ignore Virtual Interfaces
        if (lowerName.includes('virtual') || lowerName.includes('vbox') || 
            lowerName.includes('wsl') || lowerName.includes('hyper-v') || 
            lowerName.includes('docker')) continue;

        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (lowerName.includes('wi-fi') || lowerName.includes('wlan') || lowerName.includes('ethernet')) {
                    return iface.address;
                }
                if (!fallbackIP) fallbackIP = iface.address;
            }
        }
    }
    return fallbackIP;
}

const currentIP = getLocalIP();

if (!currentIP) {
    console.error('❌ Error: Could not detect your local IP address. Please check your network connection.');
    process.exit(1);
}

console.log('🔄 Synchronizing IP Address...');
console.log(`📍 Detected Local IP: ${currentIP}`);

const rootPath = path.resolve(__dirname, '..');

const configs = [
    {
        name: 'App',
        path: path.join(rootPath, 'al_markazia_app', '.env'),
        updates: [
            { pattern: /SERVER_IP=\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: `SERVER_IP=${currentIP}` }
        ]
    },
    {
        name: 'Backend',
        path: path.join(rootPath, 'al_markazia_backend', '.env'),
        updates: [
            { pattern: /HOST_IP=\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: `HOST_IP=${currentIP}` },
            { pattern: /CORS_ORIGIN=http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: `CORS_ORIGIN=http://${currentIP}` }
        ]
    },
    {
        name: 'Admin Panel',
        path: path.join(rootPath, 'admin_panel', '.env'),
        updates: [
            { pattern: /HOST_IP=\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: `HOST_IP=${currentIP}` },
            { pattern: /CORS_ORIGIN=http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: `CORS_ORIGIN=http://${currentIP}` },
            { pattern: /VITE_API_URL=http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: `VITE_API_URL=http://${currentIP}` }
        ]
    }
];

configs.forEach(config => {
    if (fs.existsSync(config.path)) {
        let content = fs.readFileSync(config.path, 'utf8');
        let modified = false;

        config.updates.forEach(update => {
            if (update.pattern.test(content)) {
                content = content.replace(update.pattern, update.replacement);
                modified = true;
            }
        });

        if (modified) {
            fs.writeFileSync(config.path, content, 'utf8');
            console.log(`✅ Updated ${config.name} configuration.`);
        } else {
            console.log(`ℹ️ ${config.name} configuration is already up to date.`);
        }
    } else {
        console.log(`⚠️ Skip: ${config.name} .env not found at ${config.path}`);
    }
});

console.log('🚀 All network settings are synchronized.\n');
