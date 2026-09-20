import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db/client";
import {
  emptyLeaderboard,
  LEADERBOARD_REVALIDATE_S,
  LEADERBOARD_TZ,
  loadWeeklyLeaderboard,
  UNAVAILABLE_LEADERBOARD_COPY,
  type WeeklyLeaderboard,
} from "./leaderboard";

const loadCached = unstable_cache(
  async () => {
    const { db } = await getDb();
    return loadWeeklyLeaderboard(db);
  },
  ["weekly-agent-leaderboard"],
  { revalidate: LEADERBOARD_REVALIDATE_S },
);

/** Short-TTL cached board for the public home and `GET /api/v1/leaderboard/weekly`. */
export async function getWeeklyLeaderboard(): Promise<WeeklyLeaderboard> {
  try {
    return await loadCached();
  } catch {
    return emptyLeaderboard(new Date(), LEADERBOARD_TZ, UNAVAILABLE_LEADERBOARD_COPY);
  }
}
