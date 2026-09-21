import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerWebhookRuntime } from './pluginRuntime';

joplin.plugins.register({
	onStart: async function() {
		await registerWebhookRuntime(joplin, ContentScriptType.MarkdownItPlugin, (url, init) => fetch(url, init));
	},
});
