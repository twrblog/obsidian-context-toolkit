import { 
	Plugin, 
	Notice, 
	MarkdownView, 
	TFile, 
	WorkspaceLeaf,
	ItemView,
	CachedMetadata,
	LinkCache,
	EmbedCache,
	MetadataCache,
	Vault
} from 'obsidian';

const VIEW_TYPE_COPY_CONTEXT = 'copy-context-view';

class CopyContextView extends ItemView {
	private plugin: CopyPageContentPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: CopyPageContentPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_COPY_CONTEXT;
	}

	getDisplayText(): string {
		return 'Copy Context';
	}

	getIcon(): string {
		return 'copy';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		
		const content = container.createDiv({ cls: 'copy-context-content' });

		const button = content.createEl('button', {
			text: 'Copy note with all linked notes',
			cls: 'copy-context-description'
		});

		button.onclick = async () => {
			await this.plugin.copyWithContext();
		};

		// Add some basic styling
		this.addStyles();
	}

	private addStyles(): void {
		const style = document.createElement('style');
		style.textContent = `
			.copy-context-content {
				padding: 5px;
			}
			.copy-context-description {
				color: var(--text-muted);
				font-size: 0.9em;
				line-height: 1.4;
				padding: 8px 6px;
				width: 100%;
				max-width: 100%;
				white-space: normal;
				overflow-wrap: break-word;
				border-radius: 6px;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-secondary);
				cursor: pointer;
				box-sizing: border-box;

				/* --- Fixes Below --- */
				
				/* 1. Use Flexbox for alignment */
				display: flex;
				
				/* 2. Center text horizontally */
				justify-content: center;
				
				/* 3. Center text vertically */
				align-items: center;
				
				/* 4. Ensure a good minimum height (optional but recommended) */
				min-height: 44px; /* Adjust as needed */

				/* 5. text-align is no longer needed for centering with flexbox */
				text-align: center; /* This can be kept as a fallback or for nested elements */
			}
		`;
		document.head.appendChild(style);
	}

	async onClose(): Promise<void> {
		// Clean up if needed
	}
}

export default class CopyPageContentPlugin extends Plugin {
	private vault: Vault;
	private metadataCache: MetadataCache;

	async onload(): Promise<void> {
		this.vault = this.app.vault;
		this.metadataCache = this.app.metadataCache;

		// Register the custom view
		this.registerView(
			VIEW_TYPE_COPY_CONTEXT,
			(leaf) => new CopyContextView(leaf, this)
		);

		// Add ribbon icon to open the view
		this.addRibbonIcon('copy', 'Open Copy Context Panel', () => {
			this.activateView();
		});

		// Add command to open the view
		this.addCommand({
			id: 'open-copy-context-panel',
			name: 'Open copy context panel',
			callback: () => {
				this.activateView();
			}
		});

		// Add direct copy command
		this.addCommand({
			id: 'copy-page-with-context',
			name: 'Copy current page with linked context',
			checkCallback: (checking) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.file) {
					if (!checking) {
						this.copyWithContext();
					}
					return true;
				}
				return false;
			}
		});
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_COPY_CONTEXT);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view doesn't exist, create a new leaf in the left sidebar
			leaf = workspace.getLeftLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_COPY_CONTEXT, active: true });
			}
		}

		// Reveal the leaf in case it's in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async copyWithContext(): Promise<void> {
		// Debug: Let's see what we have
		const activeLeaf = this.app.workspace.activeLeaf;
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const activeFile = this.app.workspace.getActiveFile();
		
		console.log('Debug info:', {
			activeLeaf: activeLeaf?.getViewState().type,
			activeView: !!activeView,
			activeFile: activeFile?.name,
			hasFile: !!activeView?.file
		});

		// Try multiple ways to get the current file
		let currentFile: TFile | null = null;
		
		if (activeView?.file) {
			currentFile = activeView.file;
		} else if (activeFile) {
			currentFile = activeFile;
		}

		if (!currentFile) {
			new Notice('No markdown file is currently active. Please open a markdown file first.');
			return;
		}

		try {
			const allContent = await this.getAllLinkedContent(currentFile);
			await navigator.clipboard.writeText(allContent);
			new Notice('Page content with linked context copied to clipboard!');
		} catch (error) {
			console.error('Failed to copy content:', error);
			new Notice('Failed to copy content.');
		}
	}

	private async getAllLinkedContent(currentFile: TFile): Promise<string> {
		const processedFiles = new Set<string>();
		const visitedInCurrentPath = new Set<string>();
		let combinedContent = '';

		const processFile = async (file: TFile, currentDepth: number, isRoot = false): Promise<void> => {
			// Cycle detection: if we've seen this file in the current path, skip it
			if (visitedInCurrentPath.has(file.path)) {
				return;
			}

			// If we've already processed this file globally, skip (but don't count as cycle)
			if (processedFiles.has(file.path)) {
				return;
			}

			// Add to both sets
			processedFiles.add(file.path);
			visitedInCurrentPath.add(file.path);

			try {
				const content = await this.vault.read(file);
				
				if (isRoot) {
					combinedContent += `# ${file.basename}\n\n${content}\n\n`;
				} else {
					const headerLevel = Math.min(currentDepth + 1, 6);
					const headerPrefix = '#'.repeat(headerLevel);
					combinedContent += `${headerPrefix} ${file.basename}\n\n${content}\n\n`;
				}

				// Follow links to next depth
				const fileCache: CachedMetadata | null = this.metadataCache.getFileCache(file);
				const links: LinkCache[] = fileCache?.links || [];
				const embeds: EmbedCache[] = fileCache?.embeds || [];
				
				const allLinks: (LinkCache | EmbedCache)[] = [...links, ...embeds];
				
				for (const link of allLinks) {
					const linkedFile: TFile | null = this.metadataCache.getFirstLinkpathDest(link.link, file.path);
					
					if (linkedFile && !visitedInCurrentPath.has(linkedFile.path)) {
						await processFile(linkedFile, currentDepth + 1);
					}
				}

			} catch (error) {
				console.warn(`Could not read file: ${file.path}`, error);
				const depthIndicator = isRoot ? '' : ` (depth ${currentDepth})`;
				const headerLevel = Math.min(currentDepth + 1, 6);
				const headerPrefix = '#'.repeat(headerLevel);
				combinedContent += `${headerPrefix} ${file.basename}${depthIndicator}\n\n[Could not read file content]\n\n`;
			}

			// Remove from current path when we're done with this branch
			visitedInCurrentPath.delete(file.path);
		};

		await processFile(currentFile, 0, true);
		
		
		return combinedContent;
	}
}