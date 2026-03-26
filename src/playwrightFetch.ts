import * as path from "path";
import { firefox, type Browser, type BrowserContext } from "playwright";

/**
 * Manages a Playwright browser instance, allowing it to be reused
 * for multiple fetches within the same session/interval.
 */
export class PlaywrightFetcher {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;

    /**
     * Launch the headless Firefox browser.
     */
    async init(): Promise<void> {
        this.browser = await firefox.launch({ headless: true });
        this.context = await this.browser.newContext({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        });
    }

    /**
     * Navigate to the target API URL, wait for the JSON response
     * (bypassing CF challenge), and return it using the shared browser context.
     */
    async fetch(targetUrl: string): Promise<any> {
        if (!this.context) {
            throw new Error("PlaywrightFetcher is not initialized. Call init() first.");
        }

        console.log(`playwright-fetch: Fetching ${targetUrl}`);
        const page = await this.context.newPage();

        try {
            await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
            await page.waitForSelector("body", { timeout: 15000 });

            // Wait a few seconds in case of a CF challenge redirecting to the actual JSON
            await page.waitForTimeout(4000);

            const content = await page.evaluate(() => document.body.innerText);

            try {
                return JSON.parse(content);
            } catch (e) {
                console.error("playwright-fetch: Failed to parse JSON. Page content preview:");
                console.error(content.substring(0, 500));
                throw new Error("Response was not valid JSON (likely stuck on Cloudflare challenge)");
            }
        } finally {
            // Close the page/tab, but keep the browser & context running
            await page.close();
        }
    }

    /**
     * Close the browser entirely, freeing up RAM.
     */
    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
        }
    }
}
