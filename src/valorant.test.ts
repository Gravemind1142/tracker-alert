import { checkAndAlert, formatMatchLine, formatDiscordMessage, ValorantDeps, ValorantState, Match, MatchesResponse, MatchDetailsResponse } from "./valorant";
import { PlaywrightFetcher } from "./playwrightFetch";

jest.mock("./playwrightFetch", () => {
    return {
        PlaywrightFetcher: jest.fn().mockImplementation(() => ({
            init: jest.fn().mockResolvedValue(undefined),
            fetch: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
        })),
    };
});

// ── Test helpers ─────────────────────────────────────────────────

function makeMatch(overrides: {
    id?: string;
    timestamp?: string;
    mapName?: string;
    agentName?: string;
    hasWon?: boolean;
    kills?: number;
    deaths?: number;
    assists?: number;
    roundsWon?: number;
    roundsLost?: number;
    tierName?: string;
    tags?: { key: string; name: string; tone: string; count: number }[];
} = {}): Match {
    return {
        attributes: { id: overrides.id ?? "match-1", mapId: "/Game/Maps/Bonsai/Bonsai" },
        metadata: {
            modeName: "Competitive",
            timestamp: overrides.timestamp ?? "2026-03-26T06:00:00.000+00:00",
            result: overrides.hasWon !== false ? "victory" : "defeat",
            mapName: overrides.mapName ?? "Split",
            seasonName: "V26: A2",
        },
        segments: [
            {
                metadata: {
                    agentName: overrides.agentName ?? "Jett",
                    hasWon: overrides.hasWon !== false,
                    result: overrides.hasWon !== false ? "victory" : "defeat",
                    tags: overrides.tags ?? [],
                },
                stats: {
                    kills: { displayName: "Kills", value: overrides.kills ?? 22, displayValue: String(overrides.kills ?? 22) },
                    deaths: { displayName: "Deaths", value: overrides.deaths ?? 15, displayValue: String(overrides.deaths ?? 15) },
                    assists: { displayName: "Assists", value: overrides.assists ?? 7, displayValue: String(overrides.assists ?? 7) },
                    kdRatio: { displayName: "K/D Ratio", value: 1.1, displayValue: "1.1" },
                    rank: {
                        displayName: "Rating",
                        value: null,
                        displayValue: "",
                        metadata: { tierName: overrides.tierName ?? "Platinum 2" },
                    },
                    roundsWon: { displayName: "Rounds Won", value: overrides.roundsWon ?? 13, displayValue: String(overrides.roundsWon ?? 13) },
                    roundsLost: { displayName: "Rounds Lost", value: overrides.roundsLost ?? 11, displayValue: String(overrides.roundsLost ?? 11) },
                    scorePerRound: { displayName: "Avg. Score", value: 290, displayValue: "290" },
                },
            },
        ],
    };
}

function makeDeps(overrides: Partial<ValorantDeps> = {}): ValorantDeps {
    return {
        fetchMatches: overrides.fetchMatches ?? jest.fn<Promise<MatchesResponse>, [string, PlaywrightFetcher]>(),
        fetchMatchDetails: overrides.fetchMatchDetails ?? jest.fn<Promise<MatchDetailsResponse>, [string, PlaywrightFetcher]>().mockResolvedValue({
            data: {
                segments: [
                    {
                        type: "player-summary",
                        attributes: { platformUserIdentifier: "ryka#eater" },
                        metadata: { partyId: "party-1" }
                    }
                ]
            }
        }),
        sendDiscordAlert: overrides.sendDiscordAlert ?? jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
        loadState: overrides.loadState ?? jest.fn<ValorantState | undefined, []>().mockReturnValue(undefined),
        saveState: overrides.saveState ?? jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined),
    };
}

// ── Tests ────────────────────────────────────────────────────────

describe("valorant", () => {
    describe("formatMatchLine", () => {
        it("should format a win with KDA and score", () => {
            const match = makeMatch({ hasWon: true, mapName: "Haven", agentName: "Sage", kills: 18, deaths: 10, assists: 5, roundsWon: 13, roundsLost: 7 });
            const line = formatMatchLine(match);
            expect(line).toContain("✅ W");
            expect(line).toContain("Haven");
            expect(line).toContain("Sage");
            expect(line).toContain("18/10/5 KDA");
            expect(line).toContain("13-7");
        });

        it("should format a loss", () => {
            const match = makeMatch({ hasWon: false, mapName: "Bind" });
            const line = formatMatchLine(match);
            expect(line).toContain("❌ L");
            expect(line).toContain("Bind");
        });

        it("should include tags when present", () => {
            const match = makeMatch({
                tags: [
                    { key: "clutch1v1", name: "1v1 Clutch", tone: "Positive", count: 1 },
                    { key: "kills3k", name: "3k", tone: "Positive", count: 1 },
                ],
            });
            const line = formatMatchLine(match);
            expect(line).toContain("`1v1 Clutch`, `3k`");
        });

        it("should include party members when present", () => {
            const match = makeMatch({ hasWon: true, mapName: "Haven" });
            match.teammates = ["Friend1#NA1", "Friend2#NA1"];
            const line = formatMatchLine(match);
            expect(line).toContain("Party (2): `Friend1#NA1`, `Friend2#NA1`");
        });
    });

    describe("formatDiscordMessage", () => {
        it("should include rank when present", () => {
            const matches = [makeMatch({ tierName: "Diamond 1" })];
            const msg = formatDiscordMessage(matches, "Diamond 1", null);
            expect(msg).toContain("📊 Rank: **Diamond 1**");
        });

        it("should show rank change when different from last", () => {
            const matches = [makeMatch({ tierName: "Diamond 1" })];
            const msg = formatDiscordMessage(matches, "Diamond 1", "Platinum 3");
            expect(msg).toContain("📊 Rank: **Diamond 1** (was Platinum 3)");
        });

        it("should include profile link", () => {
            const matches = [makeMatch()];
            const msg = formatDiscordMessage(matches, "Platinum 2", null);
            expect(msg).toContain("🔗 [View Profile]");
            expect(msg).toContain("tracker.gg/valorant/profile");
        });

        it("should include multiple match lines", () => {
            const matches = [
                makeMatch({ mapName: "Split", hasWon: true }),
                makeMatch({ mapName: "Haven", hasWon: false }),
            ];
            const msg = formatDiscordMessage(matches, "Platinum 2", null);
            expect(msg).toContain("Split");
            expect(msg).toContain("Haven");
        });
    });

    describe("checkAndAlert", () => {
        it("should report new matches after the saved timestamp", async () => {
            const oldMatch = makeMatch({ id: "old", timestamp: "2026-03-25T10:00:00.000+00:00" });
            const newMatch = makeMatch({ id: "new", timestamp: "2026-03-26T06:00:00.000+00:00" });

            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
            const saveState = jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [newMatch, oldMatch] },
                }),
                sendDiscordAlert,
                loadState: jest.fn().mockReturnValue({
                    lastCheckedTimestamp: "2026-03-25T12:00:00.000+00:00",
                    lastRank: "Platinum 2",
                }),
                saveState,
            });

            await checkAndAlert(deps);

            expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
            const message = sendDiscordAlert.mock.calls[0][0];
            expect(message).toContain("Split"); // newMatch is on Split
            expect(saveState).toHaveBeenCalledWith({
                lastCheckedTimestamp: "2026-03-26T06:00:00.000+00:00",
                lastRank: "Platinum 2",
            });
        });

        it("should not send alert when no new matches", async () => {
            const oldMatch = makeMatch({ timestamp: "2026-03-25T10:00:00.000+00:00" });

            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
            const saveState = jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [oldMatch] },
                }),
                sendDiscordAlert,
                loadState: jest.fn().mockReturnValue({
                    lastCheckedTimestamp: "2026-03-26T00:00:00.000+00:00",
                    lastRank: "Platinum 2",
                }),
                saveState,
            });

            await checkAndAlert(deps);

            expect(sendDiscordAlert).not.toHaveBeenCalled();
            // State should still be saved (updates timestamp)
            expect(saveState).toHaveBeenCalled();
        });

        it("should report all matches on fresh state (no saved timestamp)", async () => {
            const match1 = makeMatch({ id: "m1", timestamp: "2026-03-25T10:00:00.000+00:00", mapName: "Bind" });
            const match2 = makeMatch({ id: "m2", timestamp: "2026-03-26T06:00:00.000+00:00", mapName: "Haven" });

            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
            const saveState = jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [match2, match1] },
                }),
                sendDiscordAlert,
                loadState: jest.fn().mockReturnValue(undefined),
                saveState,
            });

            await checkAndAlert(deps);

            expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
            const message = sendDiscordAlert.mock.calls[0][0];
            expect(message).toContain("Bind");
            expect(message).toContain("Haven");
        });

        it("should include rank change in alert", async () => {
            const match = makeMatch({ timestamp: "2026-03-26T06:00:00.000+00:00", tierName: "Diamond 1" });

            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [match] },
                }),
                sendDiscordAlert,
                loadState: jest.fn().mockReturnValue({
                    lastCheckedTimestamp: "2026-03-25T00:00:00.000+00:00",
                    lastRank: "Platinum 3",
                }),
                saveState: jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined),
            });

            await checkAndAlert(deps);

            const message = sendDiscordAlert.mock.calls[0][0];
            expect(message).toContain("Diamond 1");
            expect(message).toContain("was Platinum 3");
        });

        it("should handle fetch failure gracefully", async () => {
            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
            const saveState = jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockRejectedValue(new Error("Network error")),
                sendDiscordAlert,
                saveState,
            });

            // Should not throw
            await checkAndAlert(deps);

            expect(sendDiscordAlert).not.toHaveBeenCalled();
            expect(saveState).not.toHaveBeenCalled();
        });

        it("should not update state if Discord alert fails", async () => {
            const match = makeMatch({ timestamp: "2026-03-26T06:00:00.000+00:00" });
            const saveState = jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [match] },
                }),
                sendDiscordAlert: jest.fn<Promise<void>, [string]>().mockRejectedValue(new Error("Webhook failed")),
                loadState: jest.fn().mockReturnValue(undefined),
                saveState,
            });

            await checkAndAlert(deps);

            expect(saveState).not.toHaveBeenCalled();
        });

        it("should handle empty matches array", async () => {
            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
            const saveState = jest.fn<Promise<void>, [ValorantState]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [] },
                }),
                sendDiscordAlert,
                saveState,
            });

            await checkAndAlert(deps);

            expect(sendDiscordAlert).not.toHaveBeenCalled();
            expect(saveState).not.toHaveBeenCalled();
        });

        it("should include teammates in alert if they are in the same party", async () => {
            const newMatch = makeMatch({ id: "new", timestamp: "2026-03-26T06:00:00.000+00:00" });

            const sendDiscordAlert = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

            const deps = makeDeps({
                fetchMatches: jest.fn<Promise<MatchesResponse>, [string]>().mockResolvedValue({
                    data: { matches: [newMatch] },
                }),
                fetchMatchDetails: jest.fn<Promise<MatchDetailsResponse>, [string]>().mockResolvedValue({
                    data: {
                        segments: [
                            { type: "player-summary", attributes: { platformUserIdentifier: "ryka#eater" }, metadata: { partyId: "party-123" } },
                            { type: "player-summary", attributes: { platformUserIdentifier: "friend#tag" }, metadata: { partyId: "party-123" } },
                            { type: "player-summary", attributes: { platformUserIdentifier: "rando#123" }, metadata: { partyId: "party-abc" } }
                        ]
                    }
                }),
                sendDiscordAlert,
                loadState: jest.fn().mockReturnValue(undefined),
                saveState: jest.fn().mockResolvedValue(undefined),
            });

            await checkAndAlert(deps);

            expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
            const message = sendDiscordAlert.mock.calls[0][0];
            expect(message).toContain("Party (1): `friend#tag`");
            expect(message).not.toContain("rando#123");
        });
    });
});
