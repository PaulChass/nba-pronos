'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { memo, useMemo } from 'react'
import type { Conf, GridPrediction, TeamAbbr } from '@/lib/types'
import { CONF_LABEL, type GridTeam } from './grid-utils'
import { TeamRow, type RowHandlers } from './TeamRow'
import styles from './GridEditor.module.css'

// @dnd-kit/modifiers is not a dependency: this is its restrictToVerticalAxis in one line.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })
const MODIFIERS = [verticalOnly]

const SCREEN_READER = {
  draggable:
    'Pour déplacer une équipe : Espace ou Entrée pour la saisir, flèches haut et bas pour la déplacer, ' +
    'Espace ou Entrée pour la poser, Échap pour annuler. Les boutons Monter et Descendre font la même chose.',
}

interface Props {
  conf: Conf
  grid: GridPrediction
  teams: Record<TeamAbbr, GridTeam>
  lines: Record<TeamAbbr, number>
  showLines: boolean
  warnings: Partial<Record<TeamAbbr, string>>
  violations: ReadonlySet<TeamAbbr>
  hotOn: ReadonlySet<TeamAbbr>
  hotBlocked: Partial<Record<TeamAbbr, string | null>>
  locked: boolean
  handlers: RowHandlers
  onReorder(conf: Conf, from: number, to: number): void
}

/** One conference: 15 sortable rows (drag by the handle, or the ↑/↓ buttons). */
export const ConferenceList = memo(function ConferenceList({
  conf,
  grid,
  teams,
  lines,
  showLines,
  warnings,
  violations,
  hotOn,
  hotBlocked,
  locked,
  handlers,
  onReorder,
}: Props) {
  const order = grid.order[conf]
  const sensors = useSensors(
    useSensor(MouseSensor),
    // Long-press on the handle so a quick swipe still scrolls the page on phones.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const announcements = useMemo<Announcements>(() => {
    const name = (id: UniqueIdentifier) => teams[String(id)]?.shortName ?? String(id)
    const rank = (id: UniqueIdentifier) => order.indexOf(String(id)) + 1
    return {
      onDragStart: ({ active }) => `${name(active.id)} : rang ${rank(active.id)} sur ${order.length}, déplacement en cours.`,
      onDragOver: ({ active, over }) => (over ? `${name(active.id)} : rang ${rank(over.id)}.` : undefined),
      onDragEnd: ({ active, over }) =>
        over ? `${name(active.id)} : nouveau rang ${rank(over.id)}.` : `${name(active.id)} reste au rang ${rank(active.id)}.`,
      onDragCancel: ({ active }) => `Déplacement annulé. ${name(active.id)} : rang ${rank(active.id)}.`,
    }
  }, [order, teams])

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onReorder(conf, order.indexOf(String(active.id)), order.indexOf(String(over.id)))
  }

  return (
    <DndContext
      id={`grille-${conf}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={MODIFIERS}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ol className={styles.list} aria-label={`Classement prévu, conférence ${CONF_LABEL[conf]}`}>
          {order.map((abbr, i) => (
            <TeamRow
              key={abbr}
              team={teams[abbr]}
              rank={i + 1}
              wins={grid.wins[abbr] ?? null}
              isFirst={i === 0}
              isLast={i === order.length - 1}
              warning={warnings[abbr]}
              violationAbove={violations.has(abbr) && i > 0 ? teams[order[i - 1]].shortName : undefined}
              line={lines[abbr]}
              showLine={showLines}
              hotOn={hotOn.has(abbr)}
              hotBlocked={hotBlocked[abbr] ?? null}
              locked={locked}
              handlers={handlers}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
})
