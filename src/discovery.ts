import {
	query as sdkQuery,
	type ModelInfo,
	type Query,
} from "@anthropic-ai/claude-agent-sdk";
import { projectSupportedModels, type ContextWindowMode } from "./models.js";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** OMP aborts runtime provider discovery at 15 seconds; finish first. */
export const CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS = 10_000;

type QueryFactory = (params: Parameters<typeof sdkQuery>[0]) => Query;

export type ClaudeModelDiscoveryOptions = {
	cwd?: string;
	pathToClaudeCodeExecutable?: string;
	timeoutMs?: number;
	queryFn?: QueryFactory;
};
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`Claude model discovery timed out after ${timeoutMs}ms`)), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		clearTimeout(timer);
	});
}

/**
 * Start a no-turn Agent SDK query solely to read its initialization catalog.
 * The query is always closed, including timeout and initialization failures.
 */
export async function discoverClaudeModels(options: ClaudeModelDiscoveryOptions = {}): Promise<ModelInfo[]> {
	const cwd = options.cwd ?? process.cwd();
	const timeoutMs = options.timeoutMs ?? CLAUDE_MODEL_DISCOVERY_TIMEOUT_MS;
	const queryFn = options.queryFn ?? sdkQuery;
	const sdkQueryInstance = queryFn({
		prompt: "",
		options: {
			cwd,
			maxTurns: 0,
			tools: [],
			strictMcpConfig: true,
			mcpServers: {},
			persistSession: false,
			permissionMode: "dontAsk",
			settingSources: [],
			env: {
				...process.env,
				CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
				ENABLE_CLAUDEAI_MCP_SERVERS: "0",
			},
			...(options.pathToClaudeCodeExecutable
				? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
			: {}),
		},
	});

	try {
		const models = await withTimeout(sdkQueryInstance.supportedModels(), timeoutMs);
		if (models.length === 0) throw new Error("Claude model discovery returned an empty catalog");
		return models;
	} finally {
		try {
			sdkQueryInstance.close();
		} catch {
			// Preserve the discovery failure (if any); close is best effort.
		}
	}
}

/** Provider catalog boundary: discovery is optional; retained exact ids are not. */
export async function discoverProviderModels(
	piAiModels: Parameters<typeof projectSupportedModels>[1] = [],
	options: ClaudeModelDiscoveryOptions & { includeAliases?: boolean; contextWindow?: ContextWindowMode } = {},
	cacheFile = join(getAgentDir(), "claude-bridge-models.json"),
) {
	let supported: ModelInfo[];
	try {
		supported = await discoverClaudeModels(options);
	} catch (error) {
		let models;
		let source = "retained exact catalog";
		try {
			const saved = JSON.parse(await readFile(cacheFile, "utf8"));
			if (saved?.version !== 1 || typeof saved.savedAt !== "number" ||
				!Number.isFinite(saved.savedAt) || saved.savedAt <= 0 || saved.savedAt > Date.now() ||
				!Array.isArray(saved.models) || saved.models.length === 0 ||
				!saved.models.every((entry: unknown) => entry !== null && typeof entry === "object" && "value" in entry && typeof entry.value === "string")) {
				throw new Error("Invalid bridge model cache");
			}
			models = projectSupportedModels(saved.models, piAiModels, options);
			source = `last-good exact catalog (age ${Math.floor((Date.now() - saved.savedAt) / 1000)}s)`;
		} catch {
			models = projectSupportedModels([], piAiModels, { contextWindow: options.contextWindow });
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(`claude-bridge: model discovery failed; using ${source}: ${message}`);
		return models;
	}
	const models = projectSupportedModels(supported, piAiModels, options);
	const temporary = `${cacheFile}.${randomUUID()}.tmp`;
	try {
		await mkdir(dirname(cacheFile), { recursive: true, mode: 0o700 });
		await writeFile(temporary, JSON.stringify({ version: 1, savedAt: Date.now(), models: supported }), { mode: 0o600 });
		await rename(temporary, cacheFile);
	} catch (error) {
		console.error(`claude-bridge: could not save last-good model catalog: ${error}`);
	} finally {
		await rm(temporary, { force: true }).catch(() => {});
	}
	return models;
}
