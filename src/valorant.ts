import { loadModuleState, saveModuleState } from "./statePersistence";
import { PlaywrightFetcher } from "./playwrightFetch";

const MATCHES_URL = "https://api.tracker.gg/api/v2/valorant/standard/matches/riot/{player}?platform=pc&season={seasonId}&type=competitive";
const STATE_KEY = "valorant";
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const SEASON_ID = "9d85c932-4820-c060-09c3-668636d4df1b";
const PLAYER = "ryka#eater";
const PROFILE_URL = `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(PLAYER)}/overview?platform=pc&playlist=competitive&season=${SEASON_ID}`;


// ── API response interfaces ──────────────────────────────────────

interface MatchStat {
    displayName: string;
    value: number | null;
    displayValue: string;
}

interface RankStat extends MatchStat {
    metadata: { tierName: string };
}

interface MatchTag {
    key: string;
    name: string;
    tone: string;
    count: number;
}

interface MatchSegment {
    metadata: {
        agentName: string;
        hasWon: boolean;
        result: string;
        tags: MatchTag[];
    };
    stats: {
        kills: MatchStat;
        deaths: MatchStat;
        assists: MatchStat;
        kdRatio: MatchStat;
        rank: RankStat;
        roundsWon: MatchStat;
        roundsLost: MatchStat;
        scorePerRound: MatchStat;
    };
}

export interface Match {
    attributes: { id: string; mapId: string };
    metadata: {
        modeName: string;
        timestamp: string;
        result: string;
        mapName: string;
        seasonName: string;
    };
    segments: MatchSegment[];
    teammates?: string[];
}

export interface MatchesResponse {
    data: { matches: Match[] };
}

export interface MatchDetailsSegment {
    type: string;
    attributes: { platformUserIdentifier?: string };
    metadata: { partyId?: string };
}

export interface MatchDetailsResponse {
    data: { segments: MatchDetailsSegment[] };
}

// ── Persisted state ──────────────────────────────────────────────

export interface ValorantState {
    lastCheckedTimestamp: string | null;
    lastRank: string | null;
}

// ── Dependencies (injectable for testing) ────────────────────────

export interface ValorantDeps {
    fetchMatches: (url: string, fetcher: PlaywrightFetcher) => Promise<MatchesResponse>;
    fetchMatchDetails: (matchId: string, fetcher: PlaywrightFetcher) => Promise<MatchDetailsResponse>;
    sendDiscordAlert: (message: string) => Promise<void>;
    loadState: () => ValorantState | undefined;
    saveState: (state: ValorantState) => Promise<void>;
}

// ── Data fetching ────────────────────────────────────────────────

function buildMatchesUrl(): string {
    return MATCHES_URL
        .replace("{player}", encodeURIComponent(PLAYER))
        .replace("{seasonId}", SEASON_ID);
}

export async function fetchMatches(url: string, fetcher: PlaywrightFetcher): Promise<MatchesResponse> {
    return fetcher.fetch(url) as Promise<MatchesResponse>;
}

export async function fetchMatchDetails(matchId: string, fetcher: PlaywrightFetcher): Promise<MatchDetailsResponse> {
    const url = `https://api.tracker.gg/api/v2/valorant/standard/matches/${matchId}`;
    return fetcher.fetch(url) as Promise<MatchDetailsResponse>;
}

// ── Discord alerting ─────────────────────────────────────────────

export function formatMatchLine(match: Match): string {
    const seg = match.segments[0];
    const result = seg.metadata.hasWon ? "✅ W" : "❌ L";
    const kda = `${seg.stats.kills.displayValue}/${seg.stats.deaths.displayValue}/${seg.stats.assists.displayValue}`;
    const score = `${seg.stats.roundsWon.displayValue}-${seg.stats.roundsLost.displayValue}`;
    const agent = seg.metadata.agentName;
    const map = match.metadata.mapName;

    let line = `${result} ${score} | ${map} | ${agent} | ${kda} KDA`;

    if (match.teammates && match.teammates.length > 0) {
        line += ` | Party (${match.teammates.length}): ${match.teammates.map(t => `\`${t}\``).join(", ")}`;
    }

    const tags = seg.metadata.tags;
    if (tags && tags.length > 0) {
        const tagNames = tags.map(t => `\`${t.name}\``).join(", ");
        line += ` | ${tagNames}`;
    }

    return line;
}

export function formatDiscordMessage(newMatches: Match[], currentRank: string | null, lastRank: string | null): string {
    const lines: string[] = [];

    lines.push(`**Valorant Match Update** — ${PLAYER}`);
    lines.push("");

    // Show rank (and whether it changed)
    if (currentRank) {
        if (lastRank && lastRank !== currentRank) {
            lines.push(`📊 Rank: **${currentRank}** (was ${lastRank})`);
        } else {
            lines.push(`📊 Rank: **${currentRank}**`);
        }
        lines.push("");
    }

    // Match summaries (newest first)
    for (const match of newMatches) {
        lines.push(formatMatchLine(match));
    }

    lines.push("");
    lines.push(`🔗 [View Profile](${PROFILE_URL})`);

    return lines.join("\n");
}

async function sendDiscordAlert(message: string): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.warn("DISCORD_WEBHOOK_URL not set, skipping alert");
        return;
    }
    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
    });
    if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    }
}

// ── Core logic ───────────────────────────────────────────────────

export async function checkAndAlert(deps: ValorantDeps): Promise<void> {
    const url = buildMatchesUrl();

    const fetcher = new PlaywrightFetcher();
    await fetcher.init();

    try {
        let matches: Match[];
        try {
            const response = await deps.fetchMatches(url, fetcher);
            matches = response.data.matches;
            // If more URLs needed fetching here, e.g. profile endpoints,
            // you would reuse `deps.fetchMatches(otherUrl, fetcher)`
        } catch (error: any) {
            console.error("Failed to fetch Valorant matches:", error);
            return;
        }

        if (!matches || matches.length === 0) {
            console.log("Valorant: No matches found");
            return;
        }

        const state = deps.loadState();
        const lastCheckedTimestamp = state?.lastCheckedTimestamp ?? null;
        const lastRank = state?.lastRank ?? null;

        // Filter to matches newer than our cutoff
        const newMatches = lastCheckedTimestamp
            ? matches.filter(m => m.metadata.timestamp > lastCheckedTimestamp)
            : matches;

        // Current rank from the most recent match
        const currentRank = matches[0].segments[0].stats.rank.metadata.tierName ?? null;

        await Promise.all(newMatches.map(async (match) => {
            try {
                const details = await deps.fetchMatchDetails(match.attributes.id, fetcher);
                const playerSegments = details.data.segments.filter(s => s.type === "player-summary");

                const targetSegment = playerSegments.find(s =>
                    s.attributes.platformUserIdentifier?.toLowerCase() === PLAYER.toLowerCase()
                );

                if (targetSegment && targetSegment.metadata?.partyId) {
                    const targetPartyId = targetSegment.metadata.partyId;
                    const teammates = playerSegments
                        .filter(s =>
                            s.metadata?.partyId === targetPartyId &&
                            s.attributes.platformUserIdentifier?.toLowerCase() !== PLAYER.toLowerCase()
                        )
                        .map(s => s.attributes.platformUserIdentifier ?? "Unknown");

                    if (teammates.length > 0) {
                        match.teammates = teammates;
                    }
                }
            } catch (error: any) {
                console.error(`Failed to fetch details for match ${match.attributes.id}:`, error);
            }
        }));

        if (newMatches.length > 0) {
            const message = formatDiscordMessage(newMatches, currentRank, lastRank);
            try {
                await deps.sendDiscordAlert(message);
                console.log(`Valorant: Reported ${newMatches.length} new match(es)`);
            } catch (error) {
                console.error("Failed to send Discord alert:", error);
                return; // Don't update state if alert failed
            }
        } else {
            console.log("Valorant: No new matches");
        }

        // Find the newest match timestamp to save
        const newestTimestamp = matches
            .map(m => m.metadata.timestamp)
            .sort()
            .pop()!;

        await deps.saveState({
            lastCheckedTimestamp: newestTimestamp,
            lastRank: currentRank,
        });
    } finally {
        await fetcher.close();
    }
}

// ── Entry point ──────────────────────────────────────────────────

export function start(): void {
    const productionDeps: ValorantDeps = {
        fetchMatches,
        fetchMatchDetails,
        sendDiscordAlert,
        loadState: () => loadModuleState<ValorantState>(STATE_KEY),
        saveState: (state) => saveModuleState(STATE_KEY, state),
    };

    // Run immediately
    checkAndAlert(productionDeps);

    // Schedule
    setInterval(() => {
        checkAndAlert(productionDeps);
    }, INTERVAL_MS);
}
