import { chromium } from "playwright";
import { PlaywrightFetcher } from "./playwrightFetch";

const mockEvaluate = jest.fn();
const mockWaitForTimeout = jest.fn().mockResolvedValue(undefined);
const mockWaitForSelector = jest.fn().mockResolvedValue(undefined);
const mockGoto = jest.fn().mockResolvedValue(undefined);
const mockPageClose = jest.fn().mockResolvedValue(undefined);
const mockNewPage = jest.fn().mockResolvedValue({
    goto: mockGoto,
    waitForTimeout: mockWaitForTimeout,
    waitForSelector: mockWaitForSelector,
    evaluate: mockEvaluate,
    close: mockPageClose,
});
const mockNewContext = jest.fn().mockResolvedValue({
    newPage: mockNewPage,
});
const mockClose = jest.fn().mockResolvedValue(undefined);

jest.mock("playwright", () => {
    return {
        chromium: {
            launch: jest.fn(),
        },
    };
});

describe("playwrightFetch", () => {
    let fetcher: PlaywrightFetcher;

    beforeEach(async () => {
        jest.clearAllMocks();
        (chromium.launch as jest.Mock).mockResolvedValue({
            newContext: mockNewContext,
            close: mockClose,
        });
        fetcher = new PlaywrightFetcher();
        await fetcher.init();
    });

    afterEach(async () => {
        await fetcher.close();
    });

    it("should fetch and parse JSON successfully", async () => {
        mockEvaluate.mockResolvedValue('{"data":{"matches":[]}}');

        const result = await fetcher.fetch("https://example.com/test");

        expect(result).toEqual({ data: { matches: [] } });
        expect(mockGoto).toHaveBeenCalledWith("https://example.com/test", { waitUntil: "domcontentloaded" });
        expect(mockWaitForSelector).toHaveBeenCalledWith("body", { timeout: 15000 });
        expect(mockWaitForTimeout).toHaveBeenCalledWith(4000);
        expect(mockPageClose).toHaveBeenCalled();
    });

    it("should throw error if response is not valid JSON", async () => {
        // e.g., stuck on CF challenge page
        mockEvaluate.mockResolvedValue('<!DOCTYPE html><html><body>CF Challenge</body></html>');

        await expect(fetcher.fetch("https://example.com/fail")).rejects.toThrow(/not valid JSON/);
    });

    it("should throw error if network fails", async () => {
        mockGoto.mockRejectedValueOnce(new Error("Network error"));

        await expect(fetcher.fetch("https://example.com/error")).rejects.toThrow("Network error");
    });
});
