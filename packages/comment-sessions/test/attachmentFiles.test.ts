import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	attachedFilesNote,
	readUploadImages,
	saveAttachment,
	uniqueFileName,
} from "../src/attachmentFiles.js";

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

describe("saveAttachment", () => {
	it("keeps existing files, reuses the same content and numbers other files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "attachments-"));
		await writeFile(join(dir, "shot.png"), "other");

		const first = await saveAttachment(dir, "shot.png", PNG);
		const again = await saveAttachment(dir, "shot.png", PNG);

		expect(first).toBe(join(dir, "shot-2.png"));
		expect(again).toBe(first);
		expect(await readFile(join(dir, "shot.png"), "utf8")).toBe("other");
	});

	it("keeps a file name from leaving the folder", async () => {
		const dir = await mkdtemp(join(tmpdir(), "attachments-"));

		const path = await saveAttachment(
			join(dir, "SAY-1"),
			"../../evil.png",
			PNG,
		);

		expect(path).toBe(join(dir, "SAY-1", "evil.png"));
	});
});

describe("readUploadImages", () => {
	async function worktree() {
		const root = await mkdtemp(join(tmpdir(), "worktree-"));
		const outside = await mkdtemp(join(tmpdir(), "outside-"));
		await mkdir(join(root, ".nyrus"));
		await writeFile(join(root, ".nyrus", "after shot.png"), PNG);
		await writeFile(join(outside, "secret.png"), PNG);
		await writeFile(join(root, "notes.txt"), "not an image");
		return { root, outside };
	}

	it("reads images inside the worktree, with safe names", async () => {
		const { root } = await worktree();

		const [image] = await readUploadImages(
			[join(root, ".nyrus", "after shot.png")],
			[root],
		);

		expect(image).toMatchObject({ name: "after-shot.png", type: "image/png" });
		expect(image?.data.equals(PNG)).toBe(true);
	});

	it("refuses files outside the worktree, also through a symlink", async () => {
		const { root, outside } = await worktree();
		await symlink(join(outside, "secret.png"), join(root, "link.png"));

		await expect(
			readUploadImages([join(outside, "secret.png")], [root]),
		).rejects.toThrow("outside your working directory");
		await expect(
			readUploadImages([join(root, "link.png")], [root]),
		).rejects.toThrow("outside your working directory");
		await expect(
			readUploadImages([join(root, "..", "secret.png")], [root]),
		).rejects.toThrow();
	});

	it("refuses relative paths and files that aren't images", async () => {
		const { root } = await worktree();

		await expect(readUploadImages(["notes.txt"], [root])).rejects.toThrow(
			"absolute path",
		);
		await expect(
			readUploadImages([join(root, "notes.txt")], [root]),
		).rejects.toThrow("not a PNG, JPEG, GIF or WebP image");
	});
});

describe("uniqueFileName", () => {
	it("numbers names the ticket already has", () => {
		const taken = new Set(["before.png", "before-2.png"]);

		expect(uniqueFileName("before.png", taken)).toBe("before-3.png");
		expect(uniqueFileName("after.png", taken)).toBe("after.png");
	});
});

describe("attachedFilesNote", () => {
	it("lists the files and asks to look at images first", () => {
		expect(
			attachedFilesNote("jira", [
				{ name: "image-1.png", image: true },
				{ name: "brief.pdf", image: false },
			]),
		).toBe(
			"---\nAttached files: image-1.png, brief.pdf. Download them with the jira tool download_attachments. Screenshots often show the problem or the expected result: look at every image (Read tool) before you start.",
		);
		expect(
			attachedFilesNote("jira", [{ name: "brief.pdf", image: false }]),
		).toBe(
			"---\nAttached files: brief.pdf. Download them with the jira tool download_attachments.",
		);
		expect(attachedFilesNote("jira", [])).toBe("");
	});
});
