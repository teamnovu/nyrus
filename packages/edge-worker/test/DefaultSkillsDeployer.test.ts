import {
	access,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ILogger } from "cyrus-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultSkillsDeployer } from "../src/DefaultSkillsDeployer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_DIR = join(
	__dirname,
	"..",
	"cyrus-skills-plugin",
	"skills",
);

function createTestLogger(): ILogger {
	return {
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
		withContext: () => createTestLogger(),
	} as unknown as ILogger;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("DefaultSkillsDeployer", () => {
	let testHome: string;
	let deployer: DefaultSkillsDeployer;

	beforeEach(async () => {
		testHome = join(
			tmpdir(),
			`cyrus-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(testHome, { recursive: true });
		deployer = new DefaultSkillsDeployer(
			testHome,
			createTestLogger(),
			BUNDLED_SKILLS_DIR,
		);
	});

	afterEach(async () => {
		await rm(testHome, { recursive: true, force: true });
	});

	it("should deploy default skills when plugin directory does not exist", async () => {
		await deployer.ensureDeployed();

		const pluginPath = join(testHome, "cyrus-skills-plugin");
		expect(await exists(pluginPath)).toBe(true);

		// Plugin manifest should exist
		const manifestPath = join(pluginPath, ".claude-plugin", "plugin.json");
		expect(await exists(manifestPath)).toBe(true);

		const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
		expect(manifest.name).toBe("cyrus-skills");

		// Skills directory should exist with skills copied
		const skillsPath = join(pluginPath, "skills");
		expect(await exists(skillsPath)).toBe(true);

		const skillDirs = await readdir(skillsPath, { withFileTypes: true });
		const skillNames = skillDirs
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
		expect(skillNames.length).toBeGreaterThan(0);
		expect(skillNames).toContain("implementation");
		expect(skillNames).toContain("debug");
		expect(skillNames).toContain("verify-and-ship");
	});

	it("should not overwrite customized skills in an existing plugin directory", async () => {
		await deployer.ensureDeployed();

		const skillMd = join(
			testHome,
			"cyrus-skills-plugin",
			"skills",
			"implementation",
			"SKILL.md",
		);
		await writeFile(skillMd, "customized");

		await deployer.ensureDeployed();

		expect(await readFile(skillMd, "utf-8")).toBe("customized");
	});

	it("should add bundled skills that are missing from an existing plugin directory", async () => {
		// An older version deployed only some skills (the plugin dir exists)
		const skillsPath = join(testHome, "cyrus-skills-plugin", "skills");
		await mkdir(join(skillsPath, "debug"), { recursive: true });
		await writeFile(join(skillsPath, "debug", "SKILL.md"), "customized");

		await deployer.ensureDeployed();

		expect(
			await exists(join(skillsPath, "before-after-screenshots", "SKILL.md")),
		).toBe(true);
		expect(await exists(join(skillsPath, "implementation", "SKILL.md"))).toBe(
			true,
		);
		expect(await readFile(join(skillsPath, "debug", "SKILL.md"), "utf-8")).toBe(
			"customized",
		);
	});

	it("should create SKILL.md files in each deployed skill directory", async () => {
		await deployer.ensureDeployed();

		const skillsPath = join(testHome, "cyrus-skills-plugin", "skills");
		const skillDirs = await readdir(skillsPath, { withFileTypes: true });

		for (const entry of skillDirs) {
			if (entry.isDirectory()) {
				const skillMd = join(skillsPath, entry.name, "SKILL.md");
				expect(await exists(skillMd)).toBe(true);
			}
		}
	});
});
