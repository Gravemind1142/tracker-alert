import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadModuleState, saveModuleState } from "./statePersistence";

describe("statePersistence", () => {
    let tempDir: string;
    let stateFile: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "state-test-"));
        stateFile = path.join(tempDir, "state.json");
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should return undefined when file does not exist", () => {
        const result = loadModuleState("testModule", stateFile);
        expect(result).toBeUndefined();
    });

    it("should round-trip module state correctly", async () => {
        interface TestState { ids: string[]; count: number; }

        const testData: TestState = { ids: ["a", "b"], count: 42 };
        await saveModuleState("myModule", testData, stateFile);

        const loaded = loadModuleState<TestState>("myModule", stateFile);
        expect(loaded).toEqual(testData);
    });

    it("should return undefined for a missing key even if file exists", async () => {
        await saveModuleState("existingKey", { value: 1 }, stateFile);

        const loaded = loadModuleState("missingKey", stateFile);
        expect(loaded).toBeUndefined();
    });

    it("should return undefined when file contains invalid JSON", () => {
        fs.writeFileSync(stateFile, "NOT VALID JSON {{{", "utf-8");

        const result = loadModuleState("anyKey", stateFile);
        expect(result).toBeUndefined();
    });

    it("should preserve other modules when saving", async () => {
        await saveModuleState("moduleA", { a: 1 }, stateFile);
        await saveModuleState("moduleB", { b: 2 }, stateFile);

        expect(loadModuleState("moduleA", stateFile)).toEqual({ a: 1 });
        expect(loadModuleState("moduleB", stateFile)).toEqual({ b: 2 });
    });
});
