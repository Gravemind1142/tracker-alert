import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(process.cwd(), "state.json");

/**
 * Loads the persisted state for a specific module key.
 * Returns undefined if the key doesn't exist or the file is missing/corrupt.
 */
export function loadModuleState<T>(key: string, filePath: string = STATE_FILE): T | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return parsed[key] as T | undefined;
    } catch (error) {
        console.error("Failed to load state file:", error);
        return undefined;
    }
}

// Write queue to serialize concurrent saveModuleState calls.
// Without this, multiple async modules completing around the same time can each
// read stale state and overwrite each other's updates (classic read-modify-write race).
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Saves a module's state under the given key, merging with existing state on disk.
 * Writes are serialized through a promise queue to prevent race conditions.
 */
export function saveModuleState<T>(key: string, state: T, filePath: string = STATE_FILE): Promise<void> {
    writeQueue = writeQueue.then(() => {
        try {
            let existing: Record<string, unknown> = {};
            if (fs.existsSync(filePath)) {
                try {
                    existing = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
                } catch {
                    // Corrupt file — start fresh
                }
            }
            existing[key] = state;
            fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
        } catch (error) {
            console.error("Failed to save state file:", error);
        }
    });
    return writeQueue;
}
