import { access, cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ILogger } from "cyrus-core";

/**
 * Deploys bundled default skills to the cyrusHome directory.
 *
 * On first startup, copies all bundled skill directories from the package
 * into `~/.cyrus/cyrus-skills-plugin/skills/` so that users can inspect
 * and customize them. Later startups only add bundled skills that are not
 * there yet; existing (possibly customized) skills are never overwritten.
 *
 * Single Responsibility: this class only handles the deployment of default
 * skills from the package to the user's home directory.
 */
export class DefaultSkillsDeployer {
	private readonly bundledSkillsPath: string;
	private readonly deployedPluginPath: string;
	private readonly deployedSkillsPath: string;
	private readonly manifestDir: string;
	private readonly manifestPath: string;

	constructor(
		private readonly cyrusHome: string,
		private readonly logger: ILogger,
		bundledSkillsDir?: string,
	) {
		// Default: skills live alongside the compiled JS in dist/, placed there
		// by the copy-prompts build step. Callers (e.g. tests) can override.
		this.bundledSkillsPath =
			bundledSkillsDir ??
			join(
				dirname(fileURLToPath(import.meta.url)),
				"cyrus-skills-plugin",
				"skills",
			);
		this.deployedPluginPath = join(this.cyrusHome, "cyrus-skills-plugin");
		this.deployedSkillsPath = join(this.deployedPluginPath, "skills");
		this.manifestDir = join(this.deployedPluginPath, ".claude-plugin");
		this.manifestPath = join(this.manifestDir, "plugin.json");
	}

	/**
	 * Ensure default skills are deployed to cyrusHome.
	 *
	 * If `~/.cyrus/cyrus-skills-plugin/` does not exist, creates it and
	 * copies all bundled skills into it. If it already exists, only adds
	 * bundled skills that are missing there (e.g. a skill shipped in a newer
	 * version) and never touches existing ones — the user may have customized
	 * them.
	 */
	async ensureDeployed(): Promise<void> {
		if (await this.exists(this.deployedPluginPath)) {
			await this.addMissingSkills();
			return;
		}

		if (!(await this.exists(this.bundledSkillsPath))) {
			this.logger.warn(
				`Bundled skills not found at ${this.bundledSkillsPath} — cannot deploy defaults`,
			);
			return;
		}

		// Create plugin directory structure
		await mkdir(this.deployedSkillsPath, { recursive: true });

		// Write plugin manifest
		await mkdir(this.manifestDir, { recursive: true });
		await writeFile(
			this.manifestPath,
			JSON.stringify(
				{
					name: "cyrus-skills",
					description: "Default Cyrus workflow skills for agent sessions",
				},
				null,
				"\t",
			),
		);

		// Copy each skill directory from bundled to deployed.
		// Entries may be directories or symlinks to directories (dev vs build).
		const entries = await readdir(this.bundledSkillsPath, {
			withFileTypes: true,
		});
		let deployedCount = 0;
		for (const entry of entries) {
			if (entry.isDirectory() || entry.isSymbolicLink()) {
				const src = join(this.bundledSkillsPath, entry.name);
				const dest = join(this.deployedSkillsPath, entry.name);
				await cp(src, dest, { recursive: true, dereference: true });
				deployedCount++;
			}
		}

		this.logger.info(
			`Deployed default skills to ${this.deployedPluginPath} (${deployedCount} skills)`,
		);
	}

	/**
	 * Copy bundled skills whose directory doesn't exist in the deployed plugin
	 * yet. Existing skill directories are left as they are.
	 */
	private async addMissingSkills(): Promise<void> {
		if (!(await this.exists(this.bundledSkillsPath))) {
			this.logger.debug(
				`Default skills plugin exists at ${this.deployedPluginPath}; no bundled skills to add`,
			);
			return;
		}

		await mkdir(this.deployedSkillsPath, { recursive: true });
		const entries = await readdir(this.bundledSkillsPath, {
			withFileTypes: true,
		});
		const added: string[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			const dest = join(this.deployedSkillsPath, entry.name);
			if (await this.exists(dest)) continue;
			await cp(join(this.bundledSkillsPath, entry.name), dest, {
				recursive: true,
				dereference: true,
			});
			added.push(entry.name);
		}

		if (added.length > 0) {
			this.logger.info(
				`Added new default skills to ${this.deployedPluginPath}: ${added.join(", ")}`,
			);
		} else {
			this.logger.debug(
				`Default skills plugin already up to date at ${this.deployedPluginPath}`,
			);
		}
	}

	private async exists(path: string): Promise<boolean> {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	}
}
