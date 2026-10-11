// Export/import Tabby user data; never modify the Tabby application installation.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const vm = require('vm');
const repo = __dirname;
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = path.resolve(option('--root') || path.join(process.env.APPDATA || '', 'tabby'));
const keyPath = option('--key');
const sourceFiles = ['package.json', 'LICENSE', 'README.md', 'index.original.js', 'build.cjs', 'patch-navigation.cjs', 'cleanup-config.cjs', 'cleanup-runtime.cjs', 'cleanup-settings.cjs', 'recovery-store.cjs', 'transfer-engine.cjs', 'external-edit.cjs', 'navigation.cjs', 'sidebar.cjs', 'file-icons.cjs', 'cwd.cjs', 'activity.cjs', 'screen-reporter.cjs', 'settings-controls.cjs', 'icon-alignment.css', 'activity.css', 'activity-template.html'];
function key(create) {
    if (!keyPath) throw new Error('Specify --key with the path to your separate 32-byte key file. Never commit this key.');
    const p = path.resolve(keyPath);
    if (p === repo || p.startsWith(repo + path.sep)) throw new Error('Keep the key outside the Git repository.');
    if (!fs.existsSync(p) && create) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
    }
    const bytes = fs.readFileSync(p);
    if (bytes.length !== 32) throw new Error('Invalid key: expected 32 bytes.');
    return bytes;
}
function copyPlugin(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of [...sourceFiles, 'clipboard-upload.cjs', 'test-clipboard-upload.cjs', 'resume-transfer.cjs', 'test-resume-transfer.cjs', 'recent-folders.cjs', 'patch-recent.cjs', 'test-recent-folders.cjs', 'config-proxy-fixture.cjs', 'test-activity.cjs', 'test-external-edit.cjs', 'transfer-ui.cjs', 'patch-transfer-ui.cjs', 'test-transfer-ui.cjs']) fs.copyFileSync(path.join(from, name), path.join(to, name));
    for (const name of ['assets', 'dist']) fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true });
}
function decrypt() {
    const data = JSON.parse(fs.readFileSync(path.join(repo, 'sync/config.encrypted.json'), 'utf8'));
    if (data.format !== 'tabby-config-aes256gcm-v1') throw new Error('Unknown encrypted config format.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(false), Buffer.from(data.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data.data, 'base64')), decipher.final()]);
}
function validate() {
    const config = decrypt();
    if (!config.length) throw new Error('Empty config.');
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'sync/plugins/package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(repo, 'sync/plugins/package-lock.json')));
    if (pkg.dependencies['tabby-sftp-plus-plus'] !== 'file:../sftp-plus-plus') throw new Error('Invalid local plugin path.');
    for (const [name, spec] of Object.entries(pkg.dependencies)) {
        if (lock.packages[''].dependencies[name] !== spec || !lock.packages['node_modules/' + name]) throw new Error('Plugin lock mismatch: ' + name);
    }
    new vm.Script(fs.readFileSync(path.join(repo, 'dist/index.js'), 'utf8'));
    console.log('Config decrypted successfully; plugin bundle and dependency lock verified.');
    return config;
}
function exportSnapshot() {
    const bytes = key(true);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', bytes, iv);
    const ciphertext = Buffer.concat([cipher.update(fs.readFileSync(path.join(root, 'config.yaml'))), cipher.final()]);
    fs.mkdirSync(path.join(repo, 'sync/plugins'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'sync/config.encrypted.json'), JSON.stringify({ format: 'tabby-config-aes256gcm-v1', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') }, null, 2) + '\n');
    for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, 'plugins', name), path.join(repo, 'sync/plugins', name));
    // Preserve the repository's setup README; plugin documentation lives separately.
    const readme = fs.existsSync(path.join(repo, 'README.md')) ? fs.readFileSync(path.join(repo, 'README.md')) : null;
    copyPlugin(path.join(root, 'sftp-plus-plus'), repo);
    fs.renameSync(path.join(repo, 'README.md'), path.join(repo, 'PLUGIN.md'));
    if (readme) fs.writeFileSync(path.join(repo, 'README.md'), readme);
    const packageFile = path.join(repo, 'package.json');
    const pluginPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    // This distribution does not include the old machine-specific migration installer/tests.
    pluginPackage.scripts = { build: 'node build.cjs' };
    pluginPackage.repository = { type: 'git', url: 'git+https://github.com/nguyenminhtung199/tabby-sftp-plus-plus.git' };
    pluginPackage.homepage = 'https://github.com/nguyenminhtung199/tabby-sftp-plus-plus#readme';
    pluginPackage.bugs = { url: 'https://github.com/nguyenminhtung199/tabby-sftp-plus-plus/issues' };
    fs.writeFileSync(packageFile, JSON.stringify(pluginPackage, null, 2) + '\n');
    // Icon provenance keeps upstream-relative paths, not the exporting user's home.
    for (const folder of ['assets', 'dist/assets']) {
        const p = path.join(repo, folder, 'icon-sources.json');
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        const installation = data.installation;
        data.installation = 'Microsoft VS Code';
        for (const asset of Object.values(data.assets || {})) {
            if (typeof asset.source === 'string' && asset.source.startsWith(installation)) asset.source = asset.source.slice(installation.length + 1).replaceAll('\\', '/');
            else if (typeof asset.source === 'string' && /^[A-Za-z]:[\\/]/.test(asset.source)) asset.source = path.win32.basename(asset.source);
        }
        fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
    }
    validate();
    console.log('Export complete. Commit the repository; transfer your key separately.');
}
function install() {
    if (process.platform !== 'win32') throw new Error('This setup script currently supports Windows only.');
    // Refuse to replace config while Tabby is running.
    const running = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', "if (Get-Process -Name Tabby -ErrorAction SilentlyContinue) { exit 9 }"], { encoding: 'utf8', windowsHide: true });
    if (running.status !== 0) throw new Error('Close Tabby before installing (or the process check failed).');
    const config = validate(); // Wrong keys fail before any destination writes.
    const plugins = path.join(root, 'plugins');
    const backup = path.join(root, 'migration-backup', 'git-restore-' + Date.now());
    fs.mkdirSync(backup, { recursive: true });
    for (const name of ['config.yaml', 'plugins/package.json', 'plugins/package-lock.json']) {
        const file = path.join(root, name);
        if (fs.existsSync(file)) { const to = path.join(backup, name); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(file, to); }
    }
    fs.mkdirSync(plugins, { recursive: true });
    copyPlugin(repo, path.join(root, 'sftp-plus-plus'));
    // Restore the plugin's own documentation instead of the setup README.
    fs.copyFileSync(path.join(repo, 'PLUGIN.md'), path.join(root, 'sftp-plus-plus/README.md'));
    for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(repo, 'sync/plugins', name), path.join(plugins, name));
    console.log('Installing plugins at locked versions. Backup: ' + backup);
    const result = cp.spawnSync('npm.cmd', ['ci', '--omit=dev', '--legacy-peer-deps'], { cwd: plugins, stdio: 'inherit', shell: true, windowsHide: true });
    if (result.status !== 0) throw new Error('npm install failed. Config was not replaced. Previous manifests are in: ' + backup);
    fs.writeFileSync(path.join(root, 'config.yaml'), config);
    console.log('Installed. Open Tabby and check local SSH-key/download paths.');
}
try {
    switch (args[0]) {
        case 'export': exportSnapshot(); break;
        case 'check': validate(); break;
        case 'install': install(); break;
        default: throw new Error('Usage: node sync-config.cjs export|check|install --key <file> [--root <Tabby user-data directory>]');
    }
} catch (error) { console.error(error.message); process.exitCode = 1; }
