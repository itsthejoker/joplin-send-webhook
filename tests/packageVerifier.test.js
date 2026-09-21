const { validateArchiveEntries } = require('../scripts/verify-package');

describe('plugin package verifier', () => {
	test('requires renderer assets beside their registered content script', () => {
		expect(() => validateArchiveEntries(new Set([
			'contentScript/index.js',
			'contentScript/webhook.css',
			'contentScript/webview.js',
		]))).not.toThrow();
	});

	test('rejects renderer assets that are packaged at the archive root', () => {
		expect(() => validateArchiveEntries(new Set([
			'contentScript/index.js',
			'webhook.css',
			'webview.js',
		]))).toThrow('contentScript/webhook.css');
	});
});
