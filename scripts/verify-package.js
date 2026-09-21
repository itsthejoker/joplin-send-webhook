const fs = require('fs');
const path = require('path');
const tar = require('tar');

const rootDir = path.resolve(__dirname, '..');
const manifest = require(path.join(rootDir, 'src/manifest.json'));
const archivePath = path.join(rootDir, 'publish', `${manifest.id}.jpl`);
const requiredEntries = [
	'contentScript/index.js',
	'contentScript/webhook.css',
	'contentScript/webview.js',
];

function validateArchiveEntries(entries) {
	for (const entry of requiredEntries) {
		if (!entries.has(entry)) {
			throw new Error(`Plugin archive is missing required renderer entry: ${entry}`);
		}
	}

	for (const rootAsset of ['webhook.css', 'webview.js']) {
		if (entries.has(rootAsset)) {
			throw new Error(`Renderer asset must be packaged beside contentScript/index.js, not at archive root: ${rootAsset}`);
		}
	}
}

async function verifyPackage() {
	if (!fs.existsSync(archivePath)) {
		throw new Error(`Plugin archive does not exist: ${archivePath}`);
	}

	const entries = new Set();
	await tar.t({
		file: archivePath,
		onentry: entry => entries.add(entry.path),
	});
	validateArchiveEntries(entries);
	console.info('Verified renderer assets are packaged beside contentScript/index.js.');
}

module.exports = { validateArchiveEntries };

if (require.main === module) {
	verifyPackage().catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
