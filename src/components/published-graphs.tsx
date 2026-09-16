/**
 * THE PUBLISHED POSTS GRAPHS
 *
 * The same posts as the Records tab, drawn. This lives in its own module so it
 * can be loaded on demand: it is the only thing in the app that pulls in
 * Recharts, and importing it eagerly put ~116 kB gzipped in front of every
 * page load for a tab most visits never open.
 *
 * Nothing here computes a figure. It is handed series that already exclude
 * unreported readings, and it says how many posts each one left out.
 */

import { BarsChart, ChartCard, SERIES, TrendLine } from './charts'
import { EmptyState, PLATFORM_LABEL, PLATFORM_TOKEN } from './ui'
import type { Platform } from '../types'

export interface PublishedSeries {
  reach: Array<Record<string, string | number>>
  interactions: Array<Record<string, string | number>>
  engagement: Array<Record<string, string | number>>
  missingReach: number
  missingInteractions: number
  missingEngagement: number
}

/** Says what a chart is drawn from, and what it had to leave out. */
function chartNote(shown: number, missing: number, metric: string): string {
  const base = `${shown} post${shown === 1 ? '' : 's'} with ${metric} reported`
  return missing > 0 ? `${base} · ${missing} not reported yet, and left out` : base
}

export default function PublishedGraphs({
  charts,
  platform,
  total,
}: {
  charts: PublishedSeries
  platform: Platform
  total: number
}) {
  const nothing =
    charts.reach.length === 0 && charts.interactions.length === 0 && charts.engagement.length === 0

  if (nothing) {
    return (
      <EmptyState
        title="Nothing measured yet"
        body={`${total} ${PLATFORM_LABEL[platform]} post${total === 1 ? ' has' : 's have'} gone out, but no metric reading has come back for ${total === 1 ? 'it' : 'them'} yet. Graphs appear once the platform reports.`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ChartCard
        title="Reach and impressions"
        subtitle={chartNote(charts.reach.length, charts.missingReach, 'reach or impressions')}
        height={260}
      >
        <BarsChart
          data={charts.reach}
          series={[
            { key: 'Reach', name: 'Reach', colour: PLATFORM_TOKEN[platform] },
            { key: 'Impressions', name: 'Impressions', colour: SERIES.accent },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Interactions"
        subtitle={chartNote(charts.interactions.length, charts.missingInteractions, 'likes, comments or shares')}
        height={260}
      >
        <BarsChart
          data={charts.interactions}
          series={[
            { key: 'Likes', name: 'Likes', colour: SERIES.linkedin },
            { key: 'Comments', name: 'Comments', colour: SERIES.instagram },
            { key: 'Shares', name: 'Shares', colour: SERIES.x },
          ]}
        />
      </ChartCard>

      <ChartCard
        title="Engagement rate"
        subtitle={chartNote(charts.engagement.length, charts.missingEngagement, 'an engagement rate')}
        height={240}
      >
        <TrendLine
          data={charts.engagement}
          series={[{ key: 'Rate', name: 'Engagement rate', colour: PLATFORM_TOKEN[platform] }]}
        />
      </ChartCard>
    </div>
  )
}
