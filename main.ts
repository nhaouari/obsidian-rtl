import { App, Modal, MarkdownView, Plugin, PluginSettingTab, TFile, TAbstractFile, Setting } from 'obsidian';

class Settings {
	public fileDirections: { [path: string]: string } = {};
	public defaultDirection: string = 'ltr';
	public rememberPerFile: boolean = true;

	toJson() {
		return JSON.stringify(this);
	}

	fromJson(content: string) {
		var obj = JSON.parse(content);
		this.fileDirections = obj['fileDirections'];
		this.defaultDirection = obj['defaultDirection'];
		this.rememberPerFile = obj['rememberPerFile'];
	}
}

export default class RtlPlugin extends Plugin {

	public settings = new Settings();
	private currentFile: TFile;
	public SETTINGS_PATH = '.obsidian/rtl.json'
	// This stores the value in CodeMirror's autoCloseBrackets option before overriding it, so it can be restored when
	// we're back to LTR
	private autoCloseBracketsValue: any = false;

	onload() {
		console.log('loading RTL plugin');

		this.addCommand({
			id: 'switch-text-direction',
			name: 'Switch Text Direction (LTR<>RTL)',
			callback: () => { this.toggleDocumentDirection(); }
		});

		this.addSettingTab(new RtlSettingsTab(this.app, this));

		this.loadSettings();

		this.registerEvent(this.app.workspace.on('file-open', (file: TFile) => {
			if (file && file.path) {
				this.currentFile = file;
				this.adjustDirectionToCurrentFile();
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
			console.log("Detected deletion of", file);
			if (file && file.path && file.path in this.settings.fileDirections) {
				delete this.settings.fileDirections[file.path];
				this.saveSettings();
				console.log("Deleted the file from the map");
			}
		}));

		this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
			console.log("Detected rename:", oldPath, "=>", file);
			if (file && file.path && oldPath in this.settings.fileDirections) {
				this.settings.fileDirections[file.path] = this.settings.fileDirections[oldPath];
				delete this.settings.fileDirections[oldPath];
				this.saveSettings();
				console.log("Updated the map");
			}
		}));

		this.registerDomEvent(document, 'keydown', (ev: KeyboardEvent) => {
			// Patch Home/End issue on RTL: https://github.com/esm7/obsidian-rtl/issues/6
			if (ev.key == 'End' || ev.key == 'Home') {
				let cmEditor = this.getEditor();
				if (cmEditor.getOption("direction") == 'rtl') {
					// In theory we can execute the following regardless of the editor direction, it should always work,
					// but it's redundant and the principle in this plugin is to not interfere with Obsidian when the 
					// direction is LTR
					if (ev.key == 'End') {
						cmEditor.execCommand('goLineEnd');
					} else if (ev.key == 'Home') {
						cmEditor.execCommand('goLineStartSmart');
					}
				}
			}
		});
	}

	onunload() {
		console.log('unloading RTL plugin');
	}

	adjustDirectionToCurrentFile() {
		if (this.currentFile && this.currentFile.path) {
			if (this.settings.rememberPerFile && this.currentFile.path in this.settings.fileDirections) {
				// If the user wants to remember the direction per file, and we have a direction set for this file -- use it
				var requiredDirection = this.settings.fileDirections[this.currentFile.path];
				console.log('Found a known direction for this file:', requiredDirection)
			} else {
				// Use the default direction
				var requiredDirection = this.settings.defaultDirection;
				console.log('No known direction for this file, using the default', this.settings.defaultDirection);
			}
			this.setDocumentDirection(requiredDirection);
		}
	}

	saveSettings() {
		var settings = this.settings.toJson();
		this.app.vault.adapter.write(this.SETTINGS_PATH, settings);
	}

	loadSettings() {
		console.log("Loading RTL settings");
		this.app.vault.adapter.read(this.SETTINGS_PATH).
			then((content) => this.settings.fromJson(content)).
			catch(error => { console.log("RTL settings file not found"); });
	}

	getEditor() {
		var view = this.app.workspace.activeLeaf.view;
		if (view.getViewType() == 'markdown') {
			var markdownView = view as MarkdownView;
			var cmEditor = markdownView.sourceMode.cmEditor;
			return cmEditor;
		}
		return null;
	}

	setDocumentDirection(newDirection: string) {
		var cmEditor = this.getEditor();
		if (cmEditor && cmEditor.getOption("direction") != newDirection) {
			this.patchAutoCloseBrackets(cmEditor, newDirection);
			cmEditor.setOption("direction", newDirection);
			cmEditor.setOption("rtlMoveVisually", true);
		}
		var view = this.app.workspace.activeLeaf.view;
		if (view && view.previewMode && view.previewMode.containerEl)
			view.previewMode.containerEl.dir = newDirection;
		this.setExportDirection(newDirection);
	}

	setExportDirection(newDirection: string) {
		let styles = document.head.getElementsByTagName('style');
		for (let style of styles) {
			if (style.getText().includes('@media print')) {
				style.setText(`@media print { body { direction: ${newDirection}; } }`)
			}
		}
	}

	patchAutoCloseBrackets(cmEditor, newDirection: string) {
		// Auto-close brackets doesn't work in RTL: https://github.com/esm7/obsidian-rtl/issues/7
		// Until the actual fix is released (as part of CodeMirror), we store the value of autoCloseBrackets when
		// switching to RTL, overriding it to 'false' and restoring it when back to LTR.
		if (newDirection == 'rtl') {
			this.autoCloseBracketsValue = cmEditor.getOption('autoCloseBrackets');
			cmEditor.setOption('autoCloseBrackets', false);
		} else {
			cmEditor.setOption('autoCloseBrackets', this.autoCloseBracketsValue);
		}
	}

	toggleDocumentDirection() {
		var cmEditor = this.getEditor();
		if (cmEditor) {
			var newDirection = cmEditor.getOption("direction") == "ltr" ? "rtl" : "ltr"
			this.setDocumentDirection(newDirection);
			console.log('File', this.currentFile, 'was set to', newDirection);
			if (this.settings.rememberPerFile && this.currentFile && this.currentFile.path) {
				this.settings.fileDirections[this.currentFile.path] = newDirection;
				this.saveSettings();
			}
		}
	}
}

class RtlSettingsTab extends PluginSettingTab {
	settings: Settings;
	plugin: RtlPlugin;

	constructor(app: App, plugin: RtlPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = plugin.settings;
	}

	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'RTL Settings'});

		new Setting(containerEl)
			.setName('Remember text direction per file')
			.setDesc('Store and remember the text direction used for each file individually.')
			.addToggle(toggle => toggle.setValue(this.settings.rememberPerFile)
					   .onChange((value) => {
						   this.settings.rememberPerFile = value;
						   this.plugin.saveSettings();
						   this.plugin.adjustDirectionToCurrentFile();
					   }));

		new Setting(containerEl)
			.setName('Default text direction')
			.setDesc('What should be the default text direction in Obsidian?')
			.addDropdown(dropdown => dropdown.addOption('ltr', 'LTR')
						 .addOption('rtl', 'RTL')
						 .setValue(this.settings.defaultDirection)
						 .onChange((value) => {
							 this.settings.defaultDirection = value;
							 this.plugin.saveSettings();
							 this.plugin.adjustDirectionToCurrentFile();
						 }));
	}
}
