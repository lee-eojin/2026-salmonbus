import type { EventMap } from "@/shared/analytics/events";
import { latestSuccessOf, type PolledResource } from "@/shared/api/polledResource";
import type {
  ArrivalRoute,
  ArrivalVehicle,
  StationArrivalSelection,
  StationArrivalsResponse,
} from "@/shared/api/stationArrivals.types";
import type { ArrivalView } from "./arrivalPolicy";
import { toRemainingTime } from "@/shared/utils/remainingTime";
import { remainingTimeLabelOf } from "@/shared/utils/remainingTimeLabelOf";

const ASSUMED_WALK_SECONDS = 60;
const STALE_AFTER_POLL_SECONDS = 60;

export interface StationArrivalDetails {
  selection: StationArrivalSelection;
  resource: PolledResource<StationArrivalsResponse>;
}

export type ArrivalHideReason = EventMap["arrival_card_hidden"]["reason"];

export interface KnownArrival {
  vehicleId: string;
  expectedArrivalAt: number;
  hidden: boolean;
}

export interface ArrivalHide {
  selection: StationArrivalSelection;
  vehicleId: string;
  reason: ArrivalHideReason;
  hiddenAt: number;
  expectedArrivalAt: number;
  lastPolledAt: number;
}

export interface ArrivalHideStep {
  known: KnownArrival | null;
  hidden: boolean;
  hide: ArrivalHide | null;
}

function hideReasonAt(now: number, expectedArrivalAt: number, lastPolledAt: number): ArrivalHideReason | null {
  if (now - lastPolledAt > STALE_AFTER_POLL_SECONDS * 1000) return "stale";
  if (now + ASSUMED_WALK_SECONDS * 1000 > expectedArrivalAt) return "walk_time";
  return null;
}

function matchedVehicleOf(
  arrival: ArrivalView,
  { resource, selection }: StationArrivalDetails,
): { route: ArrivalRoute; vehicle: ArrivalVehicle } | null {
  const latest = latestSuccessOf(resource);
  if (latest === null || latest.body.stationId !== selection.stationId || arrival.vehicleId === null) return null;
  const route = latest.body.routes.find(
    ({ routeId, targetVisit }) =>
      routeId === selection.routeId &&
      targetVisit.matchStatus === "MATCHED" &&
      targetVisit.referenceVersionId === selection.referenceVersionId &&
      targetVisit.stopSequence === selection.stopSequence &&
      targetVisit.direction === selection.direction,
  );
  if (route === undefined) return null;
  const matches = route.arrivals.filter(({ vehicleId }) => vehicleId === arrival.vehicleId);
  return matches.length === 1 ? { route, vehicle: matches[0]! } : null;
}

export function nextArrivalHideStep(
  known: KnownArrival | null,
  arrival: ArrivalView | undefined,
  details: StationArrivalDetails | null,
  now: number | null,
): ArrivalHideStep {
  const remembered = known?.vehicleId === arrival?.vehicleId ? known : null;
  const clock = details === null ? null : (latestSuccessOf(details.resource)?.clock ?? null);
  if (now === null || details === null || clock === null) {
    return { known: remembered, hidden: remembered?.hidden ?? false, hide: null };
  }

  if (arrival === undefined || arrival.vehicleId === null) return { known: null, hidden: false, hide: null };
  const matchedAt = Date.parse(matchedVehicleOf(arrival, details)?.vehicle.eta.expectedArrivalAt ?? "");
  const expectedArrivalAt = Number.isNaN(matchedAt) ? remembered?.expectedArrivalAt : matchedAt;
  if (expectedArrivalAt === undefined) return { known: null, hidden: false, hide: null };

  const { vehicleId } = arrival;
  const reason = hideReasonAt(now, expectedArrivalAt, clock.servedAt);
  const hidden = reason !== null;
  const hide =
    reason !== null && !remembered?.hidden
      ? {
          selection: details.selection,
          vehicleId,
          reason,
          hiddenAt: now,
          expectedArrivalAt,
          lastPolledAt: clock.servedAt,
        }
      : null;
  return { known: { vehicleId, expectedArrivalAt, hidden }, hidden, hide };
}

export function arrivalTimingFor(arrival: ArrivalView, details: StationArrivalDetails | null): string | null {
  if (arrival.stopsAway === 0 || details === null) return null;
  const latest = latestSuccessOf(details.resource);
  if (latest === null || latest.clock === null) return null;
  const { body, clock } = latest;
  const now = clock.now();
  if (
    body.reason === "STALE" ||
    body.status !== "READY" ||
    body.snapshot === null ||
    !(now < Date.parse(body.snapshot.staleAt))
  ) {
    return null;
  }

  const matched = matchedVehicleOf(arrival, details);
  // 거리와 좌석은 watch를 유지하고, 수집 시점이 다른 ETA에서는 같은 차량의 시간만 보탠다.
  if (matched?.route.status !== "READY") return null;
  const { eta } = matched.vehicle;
  if (eta.status !== "AVAILABLE" || eta.remainingSeconds === null) return null;
  const time = toRemainingTime((Date.parse(eta.expectedArrivalAt) - now) / 1000);
  return time.kind === "known" ? remainingTimeLabelOf(time) : null;
}
