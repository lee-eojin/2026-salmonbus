import type { EventMap } from "@/shared/analytics/events";
import type { Board, Direction } from "@/shared/api/routeForecast.types";
import type { BoardEntry } from "@/shared/routing/boardEntry";
import { representativeArrival, type ArrivalTone } from "../components/arrivalPolicy";
import { stopViewsFor, type ExpandableStopView } from "../components/displayPolicy";
import type { ArrivalHide } from "../components/stationArrivalPolicy";

interface BoardViewContext {
  routeId: string;
  now: number;
  loadMs: number;
  entry: BoardEntry;
}

interface StopExpandContext {
  routeId: string;
  direction: Direction;
  rowPosition: number;
  expandIndex: number;
  source: EventMap["stop_expanded"]["source"];
}

export function boardViewedPropertiesOf(
  board: Board,
  direction: Direction,
  { routeId, now, loadMs, entry }: BoardViewContext,
): EventMap["board_viewed"] {
  const stops = stopViewsFor(board, direction);
  const toneCounts: Record<ArrivalTone, number> = { high: 0, low: 0, veryLow: 0, unavailable: 0 };
  for (const stop of stops) {
    if (stop.kind === "boarding") {
      toneCounts[stop.tone] += 1;
    }
  }

  return {
    route_id: routeId,
    direction,
    model_release_id: board.model.releaseId,
    forecast_age_sec: Math.round((now - Date.parse(board.observedAt)) / 1000),
    vehicles_in_service: board.vehiclesInService,
    boarding_stop_count: stops.filter((stop) => stop.kind !== "passThrough").length,
    forecast_stop_count: toneCounts.high + toneCounts.low + toneCounts.veryLow,
    high_count: toneCounts.high,
    low_count: toneCounts.low,
    very_low_count: toneCounts.veryLow,
    unavailable_count: toneCounts.unavailable,
    load_ms: Math.round(loadMs),
    entry,
  };
}

export function stopExpandedPropertiesOf(
  stop: ExpandableStopView,
  { routeId, direction, rowPosition, expandIndex, source }: StopExpandContext,
): EventMap["stop_expanded"] {
  const common = {
    route_id: routeId,
    direction,
    stop_id: stop.stopId,
    stop_sequence: stop.sequence,
    row_position: rowPosition,
    expand_index: expandIndex,
    source,
  };
  if (stop.kind === "noVehicle") {
    return { ...common, stop_kind: "noVehicle", arrival_count: 0 };
  }

  const representative = representativeArrival(stop.arrivals);
  if (representative.kind === "unavailable") {
    return {
      ...common,
      stop_kind: "boarding",
      forecast_status: "UNAVAILABLE",
      stops_away: representative.stopsAway,
      arrival_count: stop.arrivals.length,
    };
  }
  return {
    ...common,
    stop_kind: "boarding",
    forecast_status: "AVAILABLE",
    level: representative.level,
    stops_away: representative.stopsAway,
    arrival_count: stop.arrivals.length,
  };
}

export function arrivalCardHiddenPropertiesOf(hide: ArrivalHide): EventMap["arrival_card_hidden"] {
  const { selection, vehicleId, reason, hiddenAt, expectedArrivalAt, lastPolledAt } = hide;
  return {
    route_id: selection.routeId,
    direction: selection.direction,
    stop_id: selection.stationId,
    stop_sequence: selection.stopSequence,
    vehicle_id: vehicleId,
    hidden_at: new Date(hiddenAt).toISOString(),
    expected_arrival_at: new Date(expectedArrivalAt).toISOString(),
    last_polled_at: new Date(lastPolledAt).toISOString(),
    reason,
  };
}
