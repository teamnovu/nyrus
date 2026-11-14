import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, sep } from "node:path";

/**
 * Files moving between a ticket and an agent session, handled by a tracker's
 * MCP server. That server runs outside the session's sandbox, so it only
 * writes into the session's attachments folder and only reads images from
 * the session's worktree, never a path the agent picks freely.
 */

/** Largest image the agent may attach to a ticket. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Most numbered copies tried before giving up on a free file name. */
const MAX_COPIES = 1000;

/**
 * A file name that is safe on disk and in Markdown and Jira image syntax:
 * letters, digits, ".", "_" and "-"; everything else becomes "-".
 */
export function safeFileName(name: string, fallback = "file"): string {
	const cleaned = basename(name)
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[.-]+/, "");
	return cleaned || fallback;
}

/** The `n`th copy of a file name: `shot.png`, `shot-2.png`, `shot-3.png`... */
function numbered(name: string, n: number): string {
	if (n === 1) {
		return name;
	}
	const dot = name.lastIndexOf(".");
	return dot > 0
		? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
		: `${name}-${n}`;
}

/** `name`, or the first numbered copy not in `taken`; adds it to `taken`. */
export function uniqueFileName(name: string, taken: Set<string>): string {
	for (let n = 1; n <= MAX_COPIES; n++) {
		const candidate = numbered(name, n);
		if (!taken.has(candidate)) {
			taken.add(candidate);
			return candidate;
		}
	}
	throw new Error(`No free file name for ${name}`);
}

/**
 * Save a downloaded attachment into `dir` (created if missing) and return its
 * path. Nothing is overwritten: the same content already saved is reused (so
 * downloading again doesn't pile up copies), a different file of that name
 * gets a numbered copy.
 */
export async function saveAttachment(
	dir: string,
	name: string,
	data: Buffer,
): Promise<string> {
	await mkdir(dir, { recursive: true });
	const safe = safeFileName(name);
	for (let n = 1; n <= MAX_COPIES; n++) {
		const path = join(dir, numbered(safe, n));
		try {
			await writeFile(path, data, { flag: "wx" });
			return path;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}
			const existing = await readFile(path).catch(() => null);
			if (existing?.equals(data)) {
				return path;
			}
		}
	}
	throw new Error(`No free file name for ${name} in ${dir}`);
}

/** Whether a file looks like an image, by its MIME type or else its name. */
export function isImageFile(name: string, mimeType?: string): boolean {
	return mimeType
		? mimeType.toLowerCase().startsWith("image/")
		: /\.(?:png|jpe?g|gif|webp|bmp|svg|heic|tiff?)$/i.test(name);
}

/**
 * The note under a ticket's description in the prompt: which files are
 * attached, how to get them and, with images among them, to look at those
 * first. Empty without files.
 */
export function attachedFilesNote(
	platform: string,
	files: ReadonlyArray<{ name: string; image: boolean }>,
): string {
	if (files.length === 0) {
		return "";
	}
	const note = [
		`Attached files: ${files.map((f) => f.name).join(", ")}.`,
		`Download them with the ${platform} tool download_attachments.`,
	];
	if (files.some((f) => f.image)) {
		note.push(
			"Screenshots often show the problem or the expected result: look at every image (Read tool) before you start.",
		);
	}
	return `---\n${note.join(" ")}`;
}

/** The image type of `data` from its first bytes, or undefined if it's no PNG, JPEG, GIF or WebP. */
export function imageType(data: Buffer): string | undefined {
	if (
		data
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	) {
		return "image/png";
	}
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
		return "image/jpeg";
	}
	const gif = data.subarray(0, 6).toString("latin1");
	if (gif === "GIF87a" || gif === "GIF89a") {
		return "image/gif";
	}
	if (
		data.subarray(0, 4).toString("latin1") === "RIFF" &&
		data.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return "image/webp";
	}
	return undefined;
}

/** An image the agent attaches to a ticket, checked and read. */
export interface UploadImage {
	/** Safe file name, as it will appear on the ticket. */
	name: string;
	data: Buffer;
	type: string;
}

/** Whether `path` is `root` or inside it. Both must already be resolved. */
function isInside(path: string, root: string): boolean {
	return (
		path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
	);
}

/**
 * Read the images the agent wants to attach to a ticket. Each path must be an
 * absolute path to a regular file inside one of `roots`, also after resolving
 * symlinks (so a link can't point at a file elsewhere), at most
 * MAX_UPLOAD_BYTES, and a PNG, JPEG, GIF or WebP image.
 */
export async function readUploadImages(
	paths: readonly string[],
	roots: readonly string[],
): Promise<UploadImage[]> {
	const realRoots = (
		await Promise.all(roots.map((root) => realpath(root).catch(() => null)))
	).filter((root): root is string => root !== null);
	const images: UploadImage[] = [];
	for (const path of paths) {
		if (!isAbsolute(path)) {
			throw new Error(`${path}: give the absolute path of the file`);
		}
		const real = await realpath(path).catch(() => null);
		if (!real) {
			throw new Error(`${path} does not exist`);
		}
		if (!realRoots.some((root) => isInside(real, root))) {
			throw new Error(
				`${path} is outside your working directory; only files from there can be attached`,
			);
		}
		const info = await stat(real);
		if (!info.isFile()) {
			throw new Error(`${path} is not a file`);
		}
		if (info.size > MAX_UPLOAD_BYTES) {
			throw new Error(
				`${path} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
			);
		}
		const data = await readFile(real);
		const type = imageType(data);
		if (!type) {
			throw new Error(
				`${path} is not a PNG, JPEG, GIF or WebP image; only images can be attached`,
			);
		}
		images.push({ name: safeFileName(path, "image"), data, type });
	}
	return images;
}
