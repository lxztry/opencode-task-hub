#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = process.env.APPDATA 
    ? path.join(process.env.APPDATA, 'opencode')
    : path.join(os.homedir(), '.config', 'opencode');

const PLUGIN_DIR = path.join(CONFIG_DIR, 'plugins');
const OPENCODE_CONFIG = path.join(CONFIG_DIR, 'opencode.json');

function info(msg) {
    console.log(`  ${msg}`);
}

function success(msg) {
    console.log(`  ✅ ${msg}`);
}

function warn(msg) {
    console.log(`  ⚠️  ${msg}`);
}

async function main() {
    console.log('\n📦 OpenCode Task Hub - Post-install\n');

    // Detect if plugin needs installation
    const needsPlugin = !fs.existsSync(path.join(PLUGIN_DIR, 'task-reporter.js'));
    
    if (needsPlugin) {
        console.log('Installing task-reporter plugin...');
        
        try {
            fs.mkdirSync(PLUGIN_DIR, { recursive: true });
            fs.copyFileSync(
                path.join(__dirname, 'plugins', 'task-reporter.js'),
                path.join(PLUGIN_DIR, 'task-reporter.js')
            );
            success('Plugin installed');
        } catch (e) {
            warn(`Could not install plugin automatically: ${e.message}`);
            warn('Please run install.sh or install.bat manually');
        }
    } else {
        success('Plugin already installed');
    }

    // Check config
    if (fs.existsSync(OPENCODE_CONFIG)) {
        const config = fs.readFileSync(OPENCODE_CONFIG, 'utf-8');
        if (config.includes('task-reporter')) {
            success('Plugin configured in opencode.json');
        } else {
            warn('Plugin not found in opencode.json');
            warn('Please add "task-reporter" to your plugins list');
        }
    } else {
        info('No opencode.json found (will be created on first run)');
    }

    console.log('\n✨ Setup complete!\n');
    console.log('Next steps:');
    console.log('  npm start    - Start the server');
    console.log('  npm run dev  - Start with auto-reload');
    console.log('\nDashboard: http://localhost:3030\n');
}

main().catch(console.error);
