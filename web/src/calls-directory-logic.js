// Live channels near the truck, from Broadcastify's county list
// (POST /calls/v1/groups_ctid/<ctid>, secs_ago). The old fixed packs went stale:
// on 2026-10-20 8 of 24 preloaded talkgroups (every DPS channel, every Mesa and
// Gilbert one) had not had a call in 24 hours, because no volunteer node was
// feeding those systems. So the list is read live and sorted by the last call.
// Pure, for tests.

/** A channel counts as "live now" with a call in the last hour. */
export const LIVE_WINDOW_S = 3600;
/** The most channels one pack listens to: two live requests of 5, so the billed calls stay few. */
export const PACK_MAX = 10;
/** Channels shown in the list. */
export const LIST_MAX = 20;

/** Broadcastify's tag ("Law Dispatch", "Fire-Tac", "EMS Dispatch", ...) -> police | fire | other. */
export function kindOf(tagDescr) {
  const tag = String(tagDescr || '');
  if (/^law/i.test(tag)) return 'police';
  if (/^(fire|ems)/i.test(tag)) return 'fire';
  return 'other';
}

function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** The API's rows -> channels, newest call first. Rows without a group id or a time are dropped. */
export function parseGroups(rows) {
  if (!Array.isArray(rows)) return [];
  const seen = {};
  const out = [];
  for (const row of rows) {
    if (!row || typeof row.groupId !== 'string' || !/^\d+-\d+$/.test(row.groupId)) continue;
    const lastTs = Number(row.ts);
    if (!Number.isFinite(lastTs) || lastTs <= 0 || seen[row.groupId]) continue;
    seen[row.groupId] = true;
    const descr = clean(row.tgDescr);
    const display = clean(row.tgDisplay);
    out.push({
      groupId: row.groupId,
      name: descr || display || row.groupId,
      short: display || descr || row.groupId,
      agency: clean(row.tgCname),
      type: clean(row.tagDescr),
      kind: kindOf(row.tagDescr),
      lastTs,
    });
  }
  return out.sort((a, b) => b.lastTs - a.lastTs);
}

/** Channels with a call within windowS of nowS (seconds). */
export function liveChannels(channels, nowS, windowS = LIVE_WINDOW_S) {
  return channels.filter((c) => nowS - c.lastTs <= windowS);
}

/**
 * One-tap packs: Police, Fire & EMS, and Most active (police and fire together).
 * Each holds the PACK_MAX channels with the most recent calls; empty packs are left out.
 */
export function buildPacks(channels) {
  const take = (list) => list.slice(0, PACK_MAX).map((c) => c.groupId);
  const packs = [
    { id: 'police', name: 'Police', groups: take(channels.filter((c) => c.kind === 'police')) },
    { id: 'fire', name: 'Fire & EMS', groups: take(channels.filter((c) => c.kind === 'fire')) },
    { id: 'busy', name: 'Most active', groups: take(channels.filter((c) => c.kind !== 'other')) },
  ];
  return packs.filter((p) => p.groups.length > 0);
}

/** The channels for the list: live ones first (newest call first), then quieter ones, at most LIST_MAX. */
export function channelList(channels, nowS) {
  const live = liveChannels(channels, nowS);
  const quiet = channels.filter((c) => live.indexOf(c) < 0);
  return live.concat(quiet).slice(0, LIST_MAX);
}

/** "just now", "4 min ago", "2 h ago". */
export function ageText(lastTs, nowS) {
  const s = Math.max(0, nowS - lastTs);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
