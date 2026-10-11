'use client';

import * as bookingActions from '@/actions/bookings';
import * as messageActions from '@/actions/messages';
import * as notificationActions from '@/actions/notifications';
import * as ratingActions from '@/actions/ratings';
import * as safetyActions from '@/actions/safety';
import * as tripActions from '@/actions/trips';
import { Avatar, DangerButton, EmptyState, ErrorState, Feedback, FormField, GlassCard, Icon, Input, LoadingState as SharedLoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge, Textarea, Timeline } from '@/components/app/ui';
import { useAppAuth } from '@/lib/auth/provider';
import { use, useCallback, useEffect, useMemo, useState } from 'react';

type RecordValue = Record<string, unknown>;
type BookingAction = (...args: unknown[]) => Promise<unknown>;
type TripAction = (...args: unknown[]) => Promise<unknown>;
type MessageAction = (...args: unknown[]) => Promise<unknown>;
type RatingAction = (...args: unknown[]) => Promise<unknown>;
type SafetyAction = (...args: unknown[]) => Promise<unknown>;
type BookingStatus = 'confirmed' | 'cancelled_by_family' | 'cancelled_by_companion' | 'completed' | string;
type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | string;
type TripLifecycleStatus = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';

type BookingView = {
  id: string;
  reference: string;
  tripRequestId: string;
  companionId: string;
  totalAmount: number | null;
  currency: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  createdAt: string | null;
  updatedAt: string | null;
  tripRequest: {
    origin: string | null;
    destination: string | null;
    departureDate: string | null;
    returnDate: string | null;
    travelerName: string | null;
  } | null;
  companion: {
    id: string;
    name: string;
    ratingAverage: number | null;
    totalTrips: number | null;
  } | null;
  canCancel: boolean;
  canComplete: boolean;
};

type TripView = {
  id: string;
  bookingId: string;
  requestStatus: string;
  bookingStatus: string;
  status: TripLifecycleStatus;
  startTime: string;
  endTime: string | null;
  lastCheckIn: string | null;
};

type MessageView = {
  id: string;
  tripId: string;
  senderId: string;
  content: string;
  messageType: string;
  createdAt: string;
  isRead: boolean;
};

type NotificationView = {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

type LocationConsentView = {
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
};

type LocationView = {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt: string | null;
};

type SosStatus = 'active' | 'acknowledged' | 'resolved';

type SosEventView = {
  id: string;
  status: SosStatus;
  triggeredAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

type RatingView = {
  score: number;
  comment: string | null;
  createdAt: string;
  isMine: boolean;
};

type RatingEligibilityView = {
  eligible: boolean;
  canRate: boolean;
  hasRated: boolean;
  rating: RatingView | null;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function actionByName(...names: string[]): BookingAction | null {
  const actions = bookingActions as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name] as BookingAction;
  }
  return null;
}

function tripActionByName(...names: string[]): TripAction | null {
  const actions = tripActions as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name] as TripAction;
  }
  return null;
}

function communicationActionByName(...names: string[]): MessageAction | null {
  const actions = { ...messageActions, ...notificationActions } as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name] as MessageAction;
  }
  return null;
}

function ratingActionByName(...names: string[]): RatingAction | null {
  const actions = ratingActions as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name] as RatingAction;
  }
  return null;
}

function safetyActionByName(...names: string[]): SafetyAction | null {
  const actions = safetyActions as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name] as SafetyAction;
  }
  return null;
}

function actionFailure(value: unknown): string | null {
  return isRecord(value) && value.success === false && typeof value.error === 'string' ? value.error : null;
}

function nestedBoolean(source: RecordValue, names: string[]): boolean | undefined {
  for (const name of names) {
    if (typeof source[name] === 'boolean') return source[name];
  }
  return undefined;
}

function readPermission(source: RecordValue, names: string[]): boolean | undefined {
  const direct = nestedBoolean(source, names);
  if (direct !== undefined) return direct;
  for (const key of ['permissions', 'actions', 'capabilities']) {
    if (isRecord(source[key])) {
      const nested = nestedBoolean(source[key] as RecordValue, names);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function formatStatus(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function dateValue(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  return Number.isNaN(Date.parse(text)) ? text : new Date(text).toLocaleDateString();
}

function dateTimeValue(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleString();
}

function normalizeBooking(value: unknown, role: 'family' | 'companion'): BookingView | null {
  if (!isRecord(value)) return null;
  const booking = isRecord(value.booking) ? value.booking : value;
  const id = textValue(booking.id);
  const reference = textValue(booking.booking_reference ?? booking.bookingReference);
  const tripRequestId = textValue(booking.trip_request_id ?? booking.tripRequestId);
  const companionId = textValue(booking.companion_id ?? booking.companionId);
  const status = textValue(booking.status);
  const paymentStatus = textValue(booking.payment_status ?? booking.paymentStatus);
  if (!id || !reference || !tripRequestId || !companionId || !status || !paymentStatus) return null;

  const trip = isRecord(booking.trip_request) ? booking.trip_request
    : isRecord(booking.tripRequest) ? booking.tripRequest
      : isRecord(booking.trip) ? booking.trip : null;
  const companion = isRecord(booking.companion) ? booking.companion : null;
  const traveler = trip && (isRecord(trip.elderly_traveler) ? trip.elderly_traveler : isRecord(trip.elderly_travelers) ? trip.elderly_travelers : null);
  const permissions = {
    canCancel: readPermission(booking, ['can_cancel', 'canCancel']),
    canComplete: readPermission(booking, ['can_complete', 'canComplete']),
  };

  return {
    id,
    reference,
    tripRequestId,
    companionId,
    totalAmount: numberValue(booking.total_amount ?? booking.totalAmount),
    currency: textValue(booking.currency)?.toUpperCase() ?? 'USD',
    status,
    paymentStatus,
    createdAt: textValue(booking.created_at ?? booking.createdAt),
    updatedAt: textValue(booking.updated_at ?? booking.updatedAt),
    tripRequest: trip ? {
      origin: textValue(trip.origin_airport ?? trip.originAirport),
      destination: textValue(trip.destination_airport ?? trip.destinationAirport),
      departureDate: textValue(trip.departure_date ?? trip.departureDate),
      returnDate: textValue(trip.return_date ?? trip.returnDate),
      travelerName: traveler ? [textValue(traveler.first_name ?? traveler.firstName), textValue(traveler.last_name ?? traveler.lastName)].filter(Boolean).join(' ') || null : null,
    } : null,
    companion: companion ? {
      id: textValue(companion.id) ?? companionId,
      name: [textValue(companion.first_name ?? companion.firstName), textValue(companion.last_name ?? companion.lastName)].filter(Boolean).join(' ') || 'Companion',
      ratingAverage: numberValue(companion.rating_average ?? companion.ratingAverage),
      totalTrips: numberValue(companion.total_trips ?? companion.totalTrips),
    } : { id: companionId, name: 'Companion', ratingAverage: null, totalTrips: null },
    canCancel: permissions.canCancel ?? (status === 'confirmed' && (role === 'family' ? (paymentStatus === 'pending' || paymentStatus === 'failed') : paymentStatus === 'paid')),
    canComplete: permissions.canComplete ?? (role === 'companion' && status === 'confirmed' && paymentStatus === 'paid'),
  };
}

function bookingFromResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.booking ?? value.data ?? value;
}

function tripFromResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.trip ?? value.data ?? value;
}

function normalizeTrip(value: unknown): TripView | null {
  if (!isRecord(value)) return null;
  const id = textValue(value.id);
  const bookingId = textValue(value.booking_id ?? value.bookingId);
  const requestStatus = textValue(value.request_status ?? value.requestStatus);
  const bookingStatus = textValue(value.booking_status ?? value.bookingStatus);
  const startTime = textValue(value.start_time ?? value.startTime);
  const endTime = textValue(value.end_time ?? value.endTime);
  const lastCheckIn = textValue(value.last_check_in ?? value.lastCheckIn);
  const rawStatus = textValue(value.status);
  const derivedStatus: TripLifecycleStatus | null = requestStatus === 'booked' ? 'upcoming'
    : requestStatus === 'in_progress' || requestStatus === 'completed' || requestStatus === 'cancelled' ? requestStatus : null;
  const status: TripLifecycleStatus | null = derivedStatus ?? (rawStatus === 'upcoming' || rawStatus === 'in_progress' || rawStatus === 'completed' || rawStatus === 'cancelled' ? rawStatus : null);

  if (!id || !bookingId || !requestStatus || !bookingStatus || !startTime || !status) return null;
  return { id, bookingId, requestStatus, bookingStatus, status, startTime, endTime, lastCheckIn };
}

function normalizeMessages(value: unknown): MessageView[] {
  if (!isRecord(value) || !Array.isArray(value.messages)) return [];
  return value.messages.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id);
    const tripId = textValue(item.trip_id ?? item.tripId);
    const senderId = textValue(item.sender_clerk_id ?? item.senderId);
    const content = typeof item.content === 'string' ? item.content : null;
    const createdAt = textValue(item.created_at ?? item.createdAt);
    if (!id || !tripId || !senderId || content === null || !createdAt) return [];
    return [{ id, tripId, senderId, content, messageType: textValue(item.message_type ?? item.messageType) ?? 'text', createdAt, isRead: item.is_read === true || item.isRead === true }];
  });
}

function normalizeNotifications(value: unknown): NotificationView[] {
  if (!isRecord(value) || !Array.isArray(value.notifications)) return [];
  return value.notifications.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id);
    const title = textValue(item.title);
    const createdAt = textValue(item.created_at ?? item.createdAt);
    if (!id || !title || !createdAt) return [];
    return [{ id, title, body: textValue(item.body), isRead: item.is_read === true || item.isRead === true, readAt: textValue(item.read_at ?? item.readAt), createdAt }];
  });
}

function unwrapSafetyResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.data ?? value.result ?? value;
}

function normalizeLocationConsent(value: unknown): LocationConsentView {
  const unwrapped = unwrapSafetyResult(value);
  const source = isRecord(unwrapped) && isRecord(unwrapped.consent) ? unwrapped.consent : unwrapped;
  if (!isRecord(source)) return { granted: false, grantedAt: null, revokedAt: null };
  const revokedAt = textValue(source.revoked_at ?? source.revokedAt);
  const grantedAt = textValue(source.granted_at ?? source.grantedAt);
  const granted = typeof source.granted === 'boolean' ? source.granted
    : typeof source.is_granted === 'boolean' ? source.is_granted
      : typeof source.isGranted === 'boolean' ? source.isGranted
        : typeof source.permitted === 'boolean' ? source.permitted : source.status === 'active' || !source.status ? !revokedAt : false;
  return { granted: granted && !revokedAt && source.status !== 'expired', grantedAt, revokedAt };
}

function normalizeLocations(value: unknown): LocationView[] {
  const unwrapped = unwrapSafetyResult(value);
  const rows = isRecord(unwrapped) && Array.isArray(unwrapped.locations) ? unwrapped.locations
    : Array.isArray(unwrapped) ? unwrapped : [];
  return rows.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id) ?? `${String(item.recorded_at ?? item.recordedAt ?? '')}-${String(item.latitude)}-${String(item.longitude)}`;
    const latitude = numberValue(item.latitude ?? item.lat);
    const longitude = numberValue(item.longitude ?? item.lng ?? item.lon);
    const accuracy = numberValue(item.accuracy);
    if (!id || latitude === null || longitude === null || accuracy === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy < 0) return [];
    return [{ id, latitude, longitude, accuracy, recordedAt: textValue(item.recorded_at ?? item.recordedAt ?? item.created_at ?? item.createdAt) }];
  }).sort((left, right) => {
    const leftTime = left.recordedAt ? Date.parse(left.recordedAt) : 0;
    const rightTime = right.recordedAt ? Date.parse(right.recordedAt) : 0;
    return rightTime - leftTime;
  });
}

function normalizeSosEvents(value: unknown): SosEventView[] {
  const unwrapped = unwrapSafetyResult(value);
  const rows = isRecord(unwrapped) && Array.isArray(unwrapped.events) ? unwrapped.events
    : isRecord(unwrapped) && Array.isArray(unwrapped.sosEvents) ? unwrapped.sosEvents
      : Array.isArray(unwrapped) ? unwrapped : [];
  return rows.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id);
    const status = textValue(item.status);
    if (!id || (status !== 'active' && status !== 'acknowledged' && status !== 'resolved')) return [];
    return [{
      id,
      status,
      triggeredAt: textValue(item.triggered_at ?? item.triggeredAt ?? item.created_at ?? item.createdAt),
      acknowledgedAt: textValue(item.acknowledged_at ?? item.acknowledgedAt),
      resolvedAt: textValue(item.resolved_at ?? item.resolvedAt),
    }];
  });
}

function normalizeRating(value: unknown): RatingView | null {
  if (!isRecord(value)) return null;
  const score = numberValue(value.score);
  const comment = value.comment === null ? null : typeof value.comment === 'string' ? value.comment : null;
  const createdAt = textValue(value.created_at ?? value.createdAt);
  if (score === null || !Number.isInteger(score) || score < 1 || score > 5 || !createdAt || (typeof value.is_mine !== 'boolean' && typeof value.isMine !== 'boolean')) return null;
  return {
    score,
    comment,
    createdAt,
    isMine: value.is_mine === true || value.isMine === true,
  };
}

function normalizeRatingEligibility(value: unknown): RatingEligibilityView | null {
  if (!isRecord(value) || !isRecord(value.eligibility)) return null;
  const source = value.eligibility;
  if (typeof source.eligible !== 'boolean' || (typeof source.can_rate !== 'boolean' && typeof source.canRate !== 'boolean') || (typeof source.has_rated !== 'boolean' && typeof source.hasRated !== 'boolean')) return null;
  return {
    eligible: source.eligible,
    canRate: source.can_rate === true || source.canRate === true,
    hasRated: source.has_rated === true || source.hasRated === true,
    rating: source.rating === null || source.rating === undefined ? null : normalizeRating(source.rating),
  };
}

function normalizeRatings(value: unknown): RatingView[] {
  if (!isRecord(value) || !Array.isArray(value.ratings)) return [];
  return value.ratings.flatMap((item) => {
    const rating = normalizeRating(item);
    return rating ? [rating] : [];
  });
}

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();

  if (!isLoaded) return <LoadingState label="Loading booking..." />;
  if (!session) return <AccessState message="Please sign in to view this booking." href="/auth/sign-in" />;
  if (session.user.role !== 'family' && session.user.role !== 'companion') {
    return <AccessState message="Bookings are only available to family and companion users." />;
  }

  return <BookingDetailContent key={`${session.user.id}:${id}`} id={id} role={session.user.role} userId={session.user.id} isDevelopment={session.isDevelopment} />;
}

function BookingDetailContent({ id, role, userId, isDevelopment }: { id: string; role: 'family' | 'companion'; userId: string; isDevelopment: boolean }) {
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTripLoading, setIsTripLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tripError, setTripError] = useState<string | null>(null);
  const [tripNotFound, setTripNotFound] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [isCommunicationLoading, setIsCommunicationLoading] = useState(false);
  const [isCommunicationMutating, setIsCommunicationMutating] = useState(false);
  const [communicationError, setCommunicationError] = useState<string | null>(null);
  const [locationConsent, setLocationConsent] = useState<LocationConsentView | null>(null);
  const [locations, setLocations] = useState<LocationView[]>([]);
  const [sosEvents, setSosEvents] = useState<SosEventView[]>([]);
  const [isSafetyLoading, setIsSafetyLoading] = useState(false);
  const [isSafetyMutating, setIsSafetyMutating] = useState(false);
  const [safetyMutation, setSafetyMutation] = useState<string | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [locationLatitude, setLocationLatitude] = useState('');
  const [locationLongitude, setLocationLongitude] = useState('');
  const [locationAccuracy, setLocationAccuracy] = useState('');
  const [ratingEligibility, setRatingEligibility] = useState<RatingEligibilityView | null>(null);
  const [tripRatings, setTripRatings] = useState<RatingView[]>([]);
  const [ratingScore, setRatingScore] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState('');
  const [isRatingLoading, setIsRatingLoading] = useState(false);
  const [isRatingSubmitting, setIsRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratingSuccess, setRatingSuccess] = useState<string | null>(null);

  const loadBooking = useCallback(async () => {
    const get = actionByName('getBooking');
    if (!get) {
      setError('Booking details are unavailable. Please try again later.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await get(id);
      if (actionFailure(result)) {
        const message = actionFailure(result) as string;
        setNotFound(/not found|unavailable|forbidden|unauthorized/i.test(message));
        setError(message);
        return;
      }
      const normalized = normalizeBooking(bookingFromResult(result), role);
      if (!normalized) {
        setNotFound(true);
        setError('Booking not found or unavailable.');
        return;
      }
      setBooking(normalized);
    } catch {
      setError('Unable to load this booking. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [id, role]);

  const loadTrip = useCallback(async () => {
    const get = tripActionByName('getTripForBooking');
    if (!get) {
      setTripError('Trip details are unavailable. Please try again later.');
      setTripNotFound(false);
      setIsTripLoading(false);
      return;
    }
    setIsTripLoading(true);
    setTripError(null);
    setTripNotFound(false);
    try {
      const result = await get(id);
      const failure = actionFailure(result);
      if (failure) {
        const missing = /not found|no active trip|does not have an active trip/i.test(failure);
        setTrip(null);
        setTripNotFound(missing);
        setTripError(missing ? null : failure);
        return;
      }
      const normalized = normalizeTrip(tripFromResult(result));
      if (!normalized) {
        setTrip(null);
        setTripNotFound(true);
        setTripError(null);
        return;
      }
      setTrip(normalized);
    } catch {
      setTrip(null);
      setTripError('Unable to load this trip. Please try again.');
    } finally {
      setIsTripLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void Promise.all([loadBooking(), loadTrip()]);
  }, [loadBooking, loadTrip]);

  const loadCommunication = useCallback(async () => {
    if (!trip?.id) return;
    const listMessages = communicationActionByName('listMessages');
    const listNotifications = communicationActionByName('listNotifications');
    if (!listMessages || !listNotifications) {
      setCommunicationError('Communication details are unavailable. Please try again later.');
      return;
    }
    setIsCommunicationLoading(true);
    setCommunicationError(null);
    try {
      const [messageResult, notificationResult] = await Promise.all([
        listMessages({ tripId: trip.id, limit: 100 }),
        listNotifications({ limit: 20 }),
      ]);
      const messageFailure = actionFailure(messageResult);
      const notificationFailure = actionFailure(notificationResult);
      if (messageFailure || notificationFailure) {
        setCommunicationError(messageFailure ?? notificationFailure);
        return;
      }
      const normalizedMessages = normalizeMessages(messageResult);
      setMessages(normalizedMessages);
      setNotifications(normalizeNotifications(notificationResult));
      const markMessageRead = communicationActionByName('markMessageRead');
      const unreadIncoming = normalizedMessages.filter((message) => !message.isRead && message.senderId !== userId);
      if (markMessageRead && unreadIncoming.length > 0) {
        const readResults = await Promise.all(unreadIncoming.map((message) => markMessageRead({ messageId: message.id, tripId: message.tripId })));
        if (readResults.every((result) => !actionFailure(result))) {
          setMessages(normalizedMessages.map((message) => unreadIncoming.some((incoming) => incoming.id === message.id) ? { ...message, isRead: true } : message));
        }
      }
    } catch {
      setCommunicationError('Unable to load messages and notifications. Please try again.');
    } finally {
      setIsCommunicationLoading(false);
    }
  }, [trip?.id]);

  useEffect(() => {
    void loadCommunication();
  }, [loadCommunication]);

  const loadSafety = useCallback(async () => {
    if (!trip?.id) {
      setLocationConsent(null);
      setLocations([]);
      setSosEvents([]);
      setSafetyError(null);
      setIsSafetyLoading(false);
      return;
    }
    const getConsent = safetyActionByName('getLocationConsent');
    const listLocations = safetyActionByName('listLocations', 'listTripLocations');
    const listSosEvents = safetyActionByName('listSosEvents');
    if (!listLocations || !listSosEvents) {
      setSafetyError('Safety details are unavailable. Please try again later.');
      setIsSafetyLoading(false);
      return;
    }
    setIsSafetyLoading(true);
    setSafetyError(null);
    setLocationConsent(null);
    setLocations([]);
    setSosEvents([]);
    try {
      const [consentResult, locationResult, sosResult] = await Promise.all([
        getConsent ? getConsent({ tripId: trip.id }) : Promise.resolve(null),
        listLocations({ tripId: trip.id }),
        listSosEvents({ tripId: trip.id }),
      ]);
      const consentFailure = getConsent ? actionFailure(consentResult) : null;
      const locationFailure = actionFailure(locationResult);
      const sosFailure = actionFailure(sosResult);
      if (!consentFailure) setLocationConsent(getConsent ? normalizeLocationConsent(consentResult) : {
        granted: !locationFailure,
        grantedAt: null,
        revokedAt: null,
      });
      if (!locationFailure) setLocations(normalizeLocations(locationResult));
      if (!sosFailure) setSosEvents(normalizeSosEvents(sosResult));

      const failures: string[] = [];
      if (consentFailure) failures.push(consentFailure);
      if (locationFailure) failures.push('Location data is unavailable or you do not have permission to view it.');
      if (sosFailure) failures.push(sosFailure);
      if (failures.length > 0) setSafetyError(failures.join(' '));
    } catch {
      setSafetyError('Unable to load safety details. Please try again.');
    } finally {
      setIsSafetyLoading(false);
    }
  }, [trip?.id]);

  useEffect(() => {
    void loadSafety();
  }, [loadSafety]);

  const loadRatings = useCallback(async () => {
    if (!trip?.id || trip.status !== 'completed') {
      setRatingEligibility(null);
      setTripRatings([]);
      setRatingError(null);
      setRatingSuccess(null);
      setIsRatingLoading(false);
      return;
    }

    const getEligibility = ratingActionByName('getRatingEligibility');
    const getRatings = ratingActionByName('getRatingsForTrip');
    if (!getEligibility || !getRatings) {
      setRatingError('Rating details are unavailable. Please try again later.');
      setIsRatingLoading(false);
      return;
    }

    setIsRatingLoading(true);
    setRatingError(null);
    try {
      const input = { tripId: trip.id };
      const [eligibilityResult, ratingsResult] = await Promise.all([
        getEligibility(input),
        getRatings(input),
      ]);
      const eligibilityFailure = actionFailure(eligibilityResult);
      const ratingsFailure = actionFailure(ratingsResult);
      if (eligibilityFailure || ratingsFailure) {
        setRatingError(eligibilityFailure ?? ratingsFailure);
        return;
      }
      const normalizedEligibility = normalizeRatingEligibility(eligibilityResult);
      if (!normalizedEligibility) {
        setRatingError('Rating eligibility could not be read. Please try again.');
        return;
      }
      setRatingEligibility(normalizedEligibility);
      setTripRatings(normalizeRatings(ratingsResult));
    } catch {
      setRatingError('Unable to load ratings for this completed trip. Please try again.');
    } finally {
      setIsRatingLoading(false);
    }
  }, [trip?.id, trip?.status]);

  useEffect(() => {
    void loadRatings();
  }, [loadRatings]);

  async function submitCurrentRating() {
    if (!trip || trip.status !== 'completed' || !ratingEligibility?.canRate || isRatingSubmitting) return;
    const submit = ratingActionByName('submitRating', 'createRating');
    if (!submit) {
      setRatingError('Rating submission is unavailable. Please try again later.');
      return;
    }
    if (ratingScore === null) {
      setRatingError('Select a rating from 1 to 5 stars.');
      return;
    }
    const comment = ratingComment.trim();
    if (comment.length > 1000) {
      setRatingError('Review must be 1000 characters or fewer.');
      return;
    }

    setIsRatingSubmitting(true);
    setRatingError(null);
    setRatingSuccess(null);
    try {
      // The server derives the rater and companion from the authenticated trip relationship.
      const result = await submit({ tripId: trip.id, score: ratingScore, comment: comment || null });
      const failure = actionFailure(result);
      if (failure) {
        setRatingError(failure);
        return;
      }
      const created = isRecord(result) && result.created === true;
      setRatingSuccess(created ? 'Thanks for sharing your trip rating.' : 'This trip has already been rated.');
      await loadRatings();
    } catch {
      setRatingError('Unable to submit this rating. Please try again.');
    } finally {
      setIsRatingSubmitting(false);
    }
  }

  async function mutateSafety(action: SafetyAction | null, args: unknown[], unavailableMessage: string, actionName: string) {
    if (!action || !trip || isSafetyMutating) return;
    setIsSafetyMutating(true);
    setSafetyMutation(actionName);
    setSafetyError(null);
    try {
      const result = await action(...args);
      const failure = actionFailure(result);
      if (failure) {
        setSafetyError(failure);
        return;
      }
      await loadSafety();
    } catch {
      setSafetyError(unavailableMessage);
    } finally {
      setIsSafetyMutating(false);
      setSafetyMutation(null);
    }
  }

  async function submitCurrentLocation() {
    if (!trip || isSafetyMutating) return;
    const latitude = Number(locationLatitude);
    const longitude = Number(locationLongitude);
    const accuracy = Number(locationAccuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isInteger(accuracy) || accuracy < 0) {
      setSafetyError('Enter a valid latitude, longitude, and non-negative whole-number accuracy.');
      return;
    }
    const submit = safetyActionByName('submitLocation', 'recordTripLocation');
    await mutateSafety(submit, [{ tripId: trip.id, latitude, longitude, accuracy }], 'Unable to save the location update.', 'submit-location');
  }

  async function triggerSos() {
    if (!trip || isSafetyMutating) return;
    if (!window.confirm('Send an in-app SOS alert to the other trip participant?')) return;
    const create = safetyActionByName('createSosEvent');
    await mutateSafety(create, [{ tripId: trip.id, idempotencyKey: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}` }], 'Unable to send the SOS alert.', 'create-sos');
  }

  async function sendMessage() {
    const send = communicationActionByName('sendMessage');
    if (!send || !trip || isCommunicationMutating) return;
    const content = messageDraft.trim();
    if (!content) {
      setCommunicationError('Message content cannot be empty.');
      return;
    }
    setIsCommunicationMutating(true);
    setCommunicationError(null);
    try {
      const result = await send({
        tripId: trip.id,
        content,
        messageType: 'text',
        idempotencyKey: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${content.slice(0, 20)}`,
      });
      const failure = actionFailure(result);
      if (failure) {
        setCommunicationError(failure);
        return;
      }
      setMessageDraft('');
      await loadCommunication();
    } catch {
      setCommunicationError('Unable to send the message. Please try again.');
    } finally {
      setIsCommunicationMutating(false);
    }
  }

  async function markNotificationRead(notificationId: string) {
    const markRead = communicationActionByName('markNotificationRead');
    if (!markRead || isCommunicationMutating) return;
    setIsCommunicationMutating(true);
    setCommunicationError(null);
    try {
      const result = await markRead(notificationId);
      const failure = actionFailure(result);
      if (failure) {
        setCommunicationError(failure);
        return;
      }
      await loadCommunication();
    } catch {
      setCommunicationError('Unable to mark the notification as read.');
    } finally {
      setIsCommunicationMutating(false);
    }
  }

  const paymentTestActions = useMemo(() => ({
    paid: actionByName('markBookingPaidForDevelopment', 'markBookingPaymentPaidForDevelopment', 'testMarkBookingPaid'),
    failed: actionByName('markBookingPaymentFailedForDevelopment', 'markBookingFailedForDevelopment', 'testMarkBookingPaymentFailed'),
    state: actionByName('setDevelopmentPaymentState'),
  }), []);

  const paymentPaidAction = paymentTestActions.paid ?? (paymentTestActions.state
    ? (bookingId: unknown) => paymentTestActions.state!(bookingId, 'paid')
    : null);
  const paymentFailedAction = paymentTestActions.failed ?? (paymentTestActions.state
    ? (bookingId: unknown) => paymentTestActions.state!(bookingId, 'failed')
    : null);

  async function mutate(action: BookingAction | TripAction | null, unavailableMessage: string, actionName: string) {
    if (!action || !booking || isMutating) return;
    setIsMutating(true);
    setMutatingAction(actionName);
    setError(null);
    try {
      const result = await action(booking.id);
      const failure = actionFailure(result);
      if (failure) {
        setError(failure);
        return;
      }
      await Promise.all([loadBooking(), loadTrip()]);
    } catch {
      setError(unavailableMessage);
    } finally {
      setIsMutating(false);
      setMutatingAction(null);
    }
  }

  if (isLoading) return <LoadingState label="Loading booking details..." />;
  if (!booking) {
    return (
      <GlassCard>
        <ErrorState
          title={notFound ? 'Booking unavailable' : 'Unable to load this booking'}
          message={error ?? (notFound ? 'Booking not found or unavailable.' : 'Unable to load this booking.')}
          action={<>
            <PrimaryButton type="button" onClick={() => void loadBooking()} icon="refresh">Try Again</PrimaryButton>
            <SecondaryButton href={role === 'family' ? '/dashboard/family' : '/dashboard/companions'} icon="back">Back to Dashboard</SecondaryButton>
          </>}
        />
      </GlassCard>
    );
  }

  const cancelAction = actionByName('cancelBooking');
  const completeAction = actionByName('completeBooking');
  const startTripAction = tripActionByName('startTrip');
  const completeTripAction = tripActionByName('completeTrip');
  const cancelTripAction = tripActionByName('cancelTrip');
  const checkInAction = tripActionByName('companionCheckIn');
  const showPaymentTests = isDevelopment && role === 'family' && (paymentPaidAction !== null || paymentFailedAction !== null);
  const canStartTrip = role === 'companion' && trip?.status === 'upcoming';
  const canCheckIn = role === 'companion' && trip?.status === 'in_progress';
  const canCompleteTrip = role === 'companion' && trip?.status === 'in_progress';
  const canCancelTrip = booking.status.startsWith('cancelled_by_') && (trip === null ? tripNotFound : trip.status === 'upcoming' || trip.status === 'in_progress');
  const grantConsentAction = safetyActionByName('grantLocationConsent');
  const revokeConsentAction = safetyActionByName('revokeLocationConsent');
  const submitLocationAction = safetyActionByName('submitLocation', 'recordTripLocation');
  const createSosAction = safetyActionByName('createSosEvent');
  const acknowledgeSosAction = safetyActionByName('acknowledgeSosEvent', 'acknowledgeSos');
  const resolveSosAction = safetyActionByName('resolveSosEvent', 'resolveSos');
  const currentLocation = locations[0] ?? null;
  const tripIsOpen = trip?.status === 'upcoming' || trip?.status === 'in_progress';
  const hasActiveSos = sosEvents.some((event) => event.status === 'active');
  const visibleRatings = tripRatings.length > 0
    ? tripRatings
    : ratingEligibility?.rating
      ? [ratingEligibility.rating]
      : [];

  return (
    <div className="tb-page tb-booking-page">
      <PageHeader
        title="Booking Details"
        eyebrow={role === 'family' ? 'Your family’s journey' : 'Your assigned journey'}
        description={<span className="tb-booking-reference">Booking {booking.reference}</span>}
        backHref={role === 'family' ? '/dashboard/family' : '/dashboard/companions'}
        backLabel="Back to Dashboard"
        actions={<><SecondaryButton href="#booking-safety" icon="shield">Safety &amp; check-ins</SecondaryButton><SecondaryButton href="#booking-conversation" icon="chat">Conversation</SecondaryButton></>}
      />

      {error && <Feedback tone="danger">{error}</Feedback>}

      <BookingJourney booking={booking} trip={trip} isTripLoading={isTripLoading} />

      <div className="tb-grid tb-booking-context-grid">
        <GlassCard role="region" aria-labelledby="booking-request-title">
          <SectionHeader title="Trip Request" id="booking-request-title" icon="plane" />
          {booking.tripRequest ? <div className="tb-stack">
            <div className="tb-booking-route" aria-label="Trip route">
              <div><span className="tb-muted tb-small">From</span><strong>{booking.tripRequest.origin?.toUpperCase() ?? 'Origin not supplied'}</strong></div>
              <span className="tb-booking-route-link" aria-hidden="true"><Icon name="arrow" /></span>
              <div><span className="tb-muted tb-small">To</span><strong>{booking.tripRequest.destination?.toUpperCase() ?? 'Destination not supplied'}</strong></div>
            </div>
            <dl className="tb-details">
              <div><dt>Departure</dt><dd>{dateValue(booking.tripRequest.departureDate) ?? 'Departure date not supplied'}</dd></div>
              <div><dt>Return</dt><dd>{booking.tripRequest.returnDate ? dateValue(booking.tripRequest.returnDate) : 'One-way'}</dd></div>
              {booking.tripRequest.travelerName ? <div><dt>Traveler</dt><dd>{booking.tripRequest.travelerName}</dd></div> : null}
            </dl>
          </div> : <p className="tb-muted tb-small">Route, travel dates, and traveler details have not been supplied for this booking.</p>}
          <p className="tb-booking-record-id tb-muted tb-small">Trip request ID: {booking.tripRequestId}</p>
        </GlassCard>

        <GlassCard role="region" aria-labelledby="booking-companion-title">
          <SectionHeader title="Companion" id="booking-companion-title" icon="users" />
          <div className="tb-booking-person">
            <Avatar name={booking.companion?.name ?? 'Companion'} size="large" />
            <div className="tb-min-zero"><h3>{booking.companion?.name ?? 'Companion'}</h3><p className="tb-muted tb-small">Assigned to this booking</p></div>
          </div>
          {(booking.companion?.ratingAverage !== null || booking.companion?.totalTrips !== null) && <p className="tb-booking-reputation tb-muted tb-small">
            <Icon name="star" size={16} />
            <span>Reputation: {booking.companion?.ratingAverage !== null && booking.companion?.ratingAverage !== undefined ? `${booking.companion.ratingAverage.toFixed(2)} / 5.0` : 'Not rated'}
              {booking.companion?.totalTrips !== null && booking.companion?.totalTrips !== undefined ? ` · ${booking.companion.totalTrips} completed trip${booking.companion.totalTrips === 1 ? '' : 's'}` : ''}
            </span>
          </p>}
          <p className="tb-booking-record-id tb-muted tb-small">Companion ID: {booking.companion?.id ?? booking.companionId}</p>
        </GlassCard>
      </div>

      <div className="tb-booking-layout">
        <div className="tb-stack">
          <GlassCard role="region" aria-labelledby="booking-lifecycle-title" id="booking-lifecycle" className="tb-booking-anchor">
            <SectionHeader title="Trip Lifecycle" id="booking-lifecycle-title" description="The saved trip record and your available next steps." icon="clock" actions={trip && <StatusBadge status={trip.status}>{formatStatus(trip.status)}</StatusBadge>} />
            {isTripLoading ? <SharedLoadingState label="Loading trip details..." /> : trip ? <div className="tb-stack">
              <dl className="tb-details">
                <div><dt>Trip Status</dt><dd>{formatStatus(trip.status)}</dd></div>
                <div><dt>Trip Start</dt><dd>{dateTimeValue(trip.startTime) ?? 'Not supplied'}</dd></div>
                <div><dt>Trip End</dt><dd>{dateTimeValue(trip.endTime) ?? (trip.status === 'completed' || trip.status === 'cancelled' ? 'Not recorded' : 'Not ended')}</dd></div>
                <div><dt>Last Check-in</dt><dd>{dateTimeValue(trip.lastCheckIn) ?? 'No check-in recorded yet.'}</dd></div>
              </dl>
              {trip.status === 'completed' && <Feedback>This trip is completed. No further trip actions or check-ins are available.</Feedback>}
              {trip.status === 'cancelled' && <Feedback>This trip is cancelled. No further trip actions or check-ins are available.</Feedback>}
              {role === 'family' && (trip.status === 'upcoming' || trip.status === 'in_progress') && <p className="tb-muted tb-small">Trip updates and check-ins are visible here. Only the assigned companion can start, check in, or complete this trip.</p>}
              {role === 'companion' && trip.status === 'in_progress' && !trip.lastCheckIn && <p className="tb-muted tb-small">No check-in recorded yet. Check in when you are ready.</p>}
              {(canStartTrip || canCheckIn || canCompleteTrip || canCancelTrip) && <div className="tb-form-actions">
                {canStartTrip && startTripAction && <PrimaryButton type="button" disabled={isMutating} onClick={() => void mutate(startTripAction, 'Unable to start this trip.', 'start-trip')} icon="plane" loading={mutatingAction === 'start-trip'}>{mutatingAction === 'start-trip' ? 'Starting...' : 'Start Trip'}</PrimaryButton>}
                {canCheckIn && checkInAction && <PrimaryButton type="button" disabled={isMutating} onClick={() => void mutate(checkInAction, 'Unable to save this check-in.', 'check-in')} icon="check" loading={mutatingAction === 'check-in'}>{mutatingAction === 'check-in' ? 'Checking in...' : 'Check In'}</PrimaryButton>}
                {canCompleteTrip && completeTripAction && <SecondaryButton type="button" disabled={isMutating} onClick={() => void mutate(completeTripAction, 'Unable to complete this trip.', 'complete-trip')} icon="check" loading={mutatingAction === 'complete-trip'}>{mutatingAction === 'complete-trip' ? 'Completing...' : 'Complete Trip'}</SecondaryButton>}
                {canCancelTrip && cancelTripAction && <DangerButton type="button" disabled={isMutating} onClick={() => void mutate(cancelTripAction, 'Unable to cancel this trip.', 'cancel-trip')} loading={mutatingAction === 'cancel-trip'}>{mutatingAction === 'cancel-trip' ? 'Cancelling...' : 'Cancel Trip'}</DangerButton>}
              </div>}
            </div> : <div className="tb-stack">
              <EmptyState title="Trip record unavailable" description={tripNotFound ? 'No trip record is available for this booking yet.' : 'Trip details are not available.'} icon="calendar" />
              {tripError && <Feedback tone="danger">{tripError}</Feedback>}
              <div className="tb-actions">
                <SecondaryButton type="button" onClick={() => void loadTrip()} icon="refresh">Reload Trip</SecondaryButton>
                {canCancelTrip && cancelTripAction && <DangerButton type="button" disabled={isMutating} onClick={() => void mutate(cancelTripAction, 'Unable to cancel this trip.', 'cancel-trip')} loading={mutatingAction === 'cancel-trip'}>{mutatingAction === 'cancel-trip' ? 'Cancelling...' : 'Cancel Trip'}</DangerButton>}
              </div>
            </div>}
          </GlassCard>

          <GlassCard role="region" aria-labelledby="booking-safety-title" id="booking-safety" className="tb-booking-anchor">
            <SectionHeader title="Safety" id="booking-safety-title" icon="shield" actions={trip && <StatusBadge status="In-app safety tools" tone="neutral" />} />
            <div className="tb-stack">
              <Feedback>Safety alerts and location sharing stay inside TravelBuddy. This is an in-app alert only and does not contact emergency services.</Feedback>

              {!trip ? <EmptyState title="Safety tools are waiting for a trip record" description="Safety tools are available once this booking has an active trip record." icon="shield" /> : isSafetyLoading ? <SharedLoadingState label="Loading safety details..." /> : <>
                {safetyError && <Feedback tone="danger"><div className="tb-stack"><p>{safetyError}</p><div><SecondaryButton type="button" onClick={() => void loadSafety()} icon="refresh">Reload Safety</SecondaryButton></div></div></Feedback>}
                {!tripIsOpen && <p className="tb-muted tb-small">This trip is closed. New location updates and SOS alerts are not available.</p>}

                {tripIsOpen && createSosAction && <div className="tb-safety-panel tb-safety-callout">
                  <div><h3>Need attention?</h3><p className="tb-muted tb-small">Send an SOS alert to the other participant in this trip. This does not contact emergency services.</p></div>
                  <DangerButton type="button" disabled={isSafetyMutating} onClick={() => void triggerSos()} icon="alert" loading={safetyMutation === 'create-sos'}>{safetyMutation === 'create-sos' ? 'Sending...' : 'Send In-App SOS'}</DangerButton>
                </div>}

                <div className="tb-safety-panel tb-stack">
                  <div className="tb-safety-panel-heading">
                    <div>
                      <h3>Location sharing</h3>
                      <p className="tb-muted tb-small">{locationConsent === null ? 'Location sharing status is unavailable.' : locationConsent.granted ? 'Permitted location sharing is on.' : 'Location sharing is not permitted.'}</p>
                      {locationConsent?.grantedAt && <p className="tb-muted tb-small">Granted {dateTimeValue(locationConsent.grantedAt) ?? locationConsent.grantedAt}</p>}
                      {locationConsent?.revokedAt && !locationConsent.granted && <p className="tb-muted tb-small">Revoked {dateTimeValue(locationConsent.revokedAt) ?? locationConsent.revokedAt}</p>}
                    </div>
                    <StatusBadge status={locationConsent === null ? 'Unavailable' : locationConsent.granted ? 'Permitted' : 'Not permitted'} tone={locationConsent?.granted ? 'info' : 'neutral'} />
                  </div>
                  {role === 'family' && tripIsOpen && locationConsent !== null && (grantConsentAction || revokeConsentAction) && <div className="tb-actions">
                    {!locationConsent.granted && grantConsentAction && <PrimaryButton type="button" disabled={isSafetyMutating} onClick={() => void mutateSafety(grantConsentAction, [{ tripId: trip.id }], 'Unable to grant location sharing.', 'grant-consent')} loading={safetyMutation === 'grant-consent'}>{safetyMutation === 'grant-consent' ? 'Granting...' : 'Grant Location Sharing'}</PrimaryButton>}
                    {locationConsent.granted && revokeConsentAction && <SecondaryButton type="button" disabled={isSafetyMutating} onClick={() => void mutateSafety(revokeConsentAction, [{ tripId: trip.id }], 'Unable to revoke location sharing.', 'revoke-consent')} loading={safetyMutation === 'revoke-consent'}>{safetyMutation === 'revoke-consent' ? 'Revoking...' : 'Revoke Location Sharing'}</SecondaryButton>}
                  </div>}
                  <div className="tb-safety-location">
                    <h4>Latest permitted location</h4>
                    {currentLocation ? <dl className="tb-details tb-safety-location-data">
                      <div><dt>Latitude</dt><dd>{currentLocation.latitude}</dd></div>
                      <div><dt>Longitude</dt><dd>{currentLocation.longitude}</dd></div>
                      <div><dt>Accuracy</dt><dd>{currentLocation.accuracy} m</dd></div>
                      {currentLocation.recordedAt && <div className="tb-safety-location-time"><dt>Recorded</dt><dd>{dateTimeValue(currentLocation.recordedAt) ?? currentLocation.recordedAt}</dd></div>}
                    </dl> : <p className="tb-muted tb-small">No permitted location update is available.</p>}
                  </div>
                  <div className="tb-safety-check-in"><Icon name="clock" size={17} /><div><p className="tb-small">Last Check-in</p><p className="tb-muted tb-small">{dateTimeValue(trip.lastCheckIn) ?? 'No check-in recorded yet.'}</p><a className="tb-link" href="#booking-lifecycle">View trip status and check-in actions <Icon name="arrow" size={14} /></a></div></div>
                </div>

                {role === 'companion' && trip?.status === 'in_progress' && submitLocationAction && <div className="tb-safety-panel tb-form">
                  <div><h3>Update your assigned-trip location</h3><p className="tb-muted tb-small">Enter the current coordinates and accuracy in meters. The server records the update time.</p></div>
                  <div className="tb-form-grid tb-safety-coordinate-grid">
                    <FormField label="Latitude" htmlFor="safety-latitude"><Input id="safety-latitude" type="number" inputMode="decimal" step="any" min="-90" max="90" value={locationLatitude} onChange={(event) => setLocationLatitude(event.target.value)} placeholder="e.g. 40.7128" /></FormField>
                    <FormField label="Longitude" htmlFor="safety-longitude"><Input id="safety-longitude" type="number" inputMode="decimal" step="any" min="-180" max="180" value={locationLongitude} onChange={(event) => setLocationLongitude(event.target.value)} placeholder="e.g. -74.0060" /></FormField>
                    <FormField label="Accuracy (meters)" htmlFor="safety-accuracy"><Input id="safety-accuracy" type="number" inputMode="numeric" step="1" min="0" value={locationAccuracy} onChange={(event) => setLocationAccuracy(event.target.value)} placeholder="e.g. 25" /></FormField>
                  </div>
                  <div><PrimaryButton type="button" disabled={isSafetyMutating} onClick={() => void submitCurrentLocation()} icon="location" loading={safetyMutation === 'submit-location'}>{safetyMutation === 'submit-location' ? 'Saving...' : 'Save Location Update'}</PrimaryButton></div>
                </div>}

                <div className="tb-safety-panel tb-stack">
                  <div className="tb-safety-panel-heading"><h3>SOS alerts</h3>{hasActiveSos && <StatusBadge status="Active alert" tone="danger" />}</div>
                  {sosEvents.length === 0 ? <p className="tb-muted tb-small">No SOS alerts for this trip.</p> : <div className="tb-stack">{sosEvents.map((event) => <div key={event.id} className="tb-safety-event">
                    <div className="tb-safety-panel-heading">
                      <div><StatusBadge status={event.status} tone={event.status === 'active' ? 'danger' : event.status === 'acknowledged' ? 'info' : 'neutral'}>{formatStatus(event.status)}</StatusBadge><p className="tb-muted tb-small">Triggered {event.triggeredAt ? (dateTimeValue(event.triggeredAt) ?? event.triggeredAt) : 'time unavailable'}</p></div>
                      <div className="tb-actions">
                        {event.status === 'active' && acknowledgeSosAction && <SecondaryButton type="button" disabled={isSafetyMutating} onClick={() => void mutateSafety(acknowledgeSosAction, [{ tripId: trip.id, eventId: event.id }], 'Unable to acknowledge this SOS alert.', `acknowledge-sos-${event.id}`)} loading={safetyMutation === `acknowledge-sos-${event.id}`}>{safetyMutation === `acknowledge-sos-${event.id}` ? 'Acknowledging...' : 'Acknowledge'}</SecondaryButton>}
                        {(event.status === 'active' || event.status === 'acknowledged') && resolveSosAction && <SecondaryButton type="button" disabled={isSafetyMutating} onClick={() => void mutateSafety(resolveSosAction, [{ tripId: trip.id, eventId: event.id }], 'Unable to resolve this SOS alert.', `resolve-sos-${event.id}`)} loading={safetyMutation === `resolve-sos-${event.id}`}>{safetyMutation === `resolve-sos-${event.id}` ? 'Resolving...' : 'Resolve'}</SecondaryButton>}
                      </div>
                    </div>
                    {event.acknowledgedAt && <p className="tb-muted tb-small">Acknowledged {dateTimeValue(event.acknowledgedAt) ?? event.acknowledgedAt}</p>}
                    {event.resolvedAt && <p className="tb-muted tb-small">Resolved {dateTimeValue(event.resolvedAt) ?? event.resolvedAt}</p>}
                  </div>)}</div>}
                </div>
              </>}
            </div>
          </GlassCard>

          {trip?.status === 'completed' && <GlassCard role="region" aria-labelledby="booking-rating-title">
            <SectionHeader title="Trip Rating" id="booking-rating-title" icon="star" description="Ratings and reviews are available only after a trip is completed." actions={<StatusBadge status="completed">Completed trip</StatusBadge>} />
            {isRatingLoading ? <SharedLoadingState label="Loading rating details..." /> : <div className="tb-stack">
              {ratingError && <Feedback tone="danger"><div className="tb-stack"><p>{ratingError}</p><div><SecondaryButton type="button" onClick={() => void loadRatings()} icon="refresh">Reload Ratings</SecondaryButton></div></div></Feedback>}
              {ratingSuccess && <Feedback tone="success">{ratingSuccess}</Feedback>}

              {visibleRatings.length > 0 && <div className="tb-stack">
                <h3 className="tb-booking-subheading">Authorized trip feedback</h3>
                {visibleRatings.map((rating, index) => <div key={`${rating.createdAt}-${index}`} className="tb-booking-rating">
                  <div className="tb-safety-panel-heading">
                    <p className="tb-small">{rating.isMine ? 'Your rating' : 'Trip rating'}: <span className="tb-booking-stars" aria-label={`${rating.score} out of 5 stars`}>{'★'.repeat(rating.score)}{'☆'.repeat(5 - rating.score)}</span> <span className="tb-muted">{rating.score}/5</span></p>
                    <time className="tb-muted tb-small" dateTime={rating.createdAt}>{dateTimeValue(rating.createdAt) ?? rating.createdAt}</time>
                  </div>
                  {rating.comment && <p className="tb-booking-review tb-small">{rating.comment}</p>}
                </div>)}
              </div>}

              {ratingEligibility?.hasRated ? <Feedback>This completed trip has already been rated. The saved rating and review are shown above.</Feedback>
                : ratingEligibility?.eligible && ratingEligibility.canRate ? <div className="tb-safety-panel tb-form">
                  <div><h3>How was your trip with {booking.companion?.name ?? 'your companion'}?</h3><p className="tb-muted tb-small">Share a rating and an optional review to help keep the community informed.</p></div>
                  <div>
                    <p className="tb-small">Rating</p>
                    <div role="radiogroup" aria-label="Trip rating from 1 to 5 stars" className="tb-booking-rating-picker">
                      {[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" role="radio" aria-checked={ratingScore === score} aria-label={`${score} star${score === 1 ? '' : 's'}`} onClick={() => { setRatingScore(score); setRatingError(null); }} className={`tb-booking-rating-star ${ratingScore !== null && score <= ratingScore ? 'tb-booking-rating-star-selected' : ''}`}>
                        <span aria-hidden="true">{ratingScore !== null && score <= ratingScore ? '★' : '☆'}</span>
                      </button>)}
                    </div>
                    <p className="tb-muted tb-small">Choose from 1 to 5 stars.</p>
                  </div>
                  <FormField label="Optional review" htmlFor="trip-rating-comment" hint={`${ratingComment.length}/1000 characters`}>
                    <Textarea id="trip-rating-comment" value={ratingComment} onChange={(event) => { setRatingComment(event.target.value); setRatingError(null); }} maxLength={1000} rows={4} placeholder="Share a brief review of the completed trip" aria-describedby="trip-rating-comment-hint" />
                  </FormField>
                  <div><PrimaryButton type="button" disabled={isRatingSubmitting || ratingScore === null} onClick={() => void submitCurrentRating()} icon="star" loading={isRatingSubmitting}>
                    {isRatingSubmitting ? 'Submitting...' : 'Submit Rating'}
                  </PrimaryButton></div>
                </div> : <p className="tb-muted tb-small">No rating is available for this completed trip yet.</p>}
            </div>}
          </GlassCard>}
        </div>

        <div className="tb-stack">
          <GlassCard role="region" aria-labelledby="booking-conversation-title" id="booking-conversation" className="tb-booking-anchor tb-chat-card">
            <SectionHeader title="Trip Conversation" id="booking-conversation-title" icon="chat" description={`Family ↔ Companion · You’re viewing as ${role === 'family' ? 'family' : 'the assigned companion'}.`} actions={notifications.some((notification) => !notification.isRead) && <StatusBadge status="Unread" tone="info">{notifications.filter((notification) => !notification.isRead).length} unread notification{notifications.filter((notification) => !notification.isRead).length === 1 ? '' : 's'}</StatusBadge>} />
            <div className="tb-stack">
              {communicationError && <Feedback tone="danger">{communicationError}</Feedback>}
              {isCommunicationLoading ? <SharedLoadingState label="Loading conversation..." /> : trip ? <>
                <div className="tb-chat-log" role="log" aria-label="Trip messages" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
                  {messages.length === 0 ? <EmptyState title="No messages yet" description="No messages yet. Send the first update to the other trip participant." icon="chat" /> : messages.map((message) => (
                    <article key={message.id} className={`tb-chat-message ${message.senderId === userId ? 'tb-chat-message-own' : 'tb-chat-message-incoming'}`}>
                      <div className="tb-chat-message-heading"><Avatar name={message.senderId === userId ? 'You' : 'Trip participant'} size="small" /><div><p>{message.senderId === userId ? 'You' : 'Trip participant'}</p>{message.senderId === userId && <span className="tb-muted tb-small">{role === 'family' ? 'Family' : 'Companion'}</span>}</div></div>
                      <div className="tb-chat-bubble"><p>{message.content}</p></div>
                      <div className="tb-chat-message-meta"><time dateTime={message.createdAt}>{dateTimeValue(message.createdAt) ?? message.createdAt}</time><span>{message.isRead ? 'Read' : message.senderId === userId ? 'Sent · Unread' : 'Unread'}</span></div>
                    </article>
                  ))}
                </div>
                {trip.status !== 'completed' && trip.status !== 'cancelled' ? <div className="tb-chat-composer">
                  <FormField label="Message" htmlFor="trip-message" hint={`${messageDraft.length}/2000 characters`}>
                    <Textarea
                      id="trip-message"
                      value={messageDraft}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      maxLength={2000}
                      rows={3}
                      placeholder="Write a message to the other trip participant"
                      aria-describedby="trip-message-hint"
                    />
                  </FormField>
                  <PrimaryButton type="button" disabled={isCommunicationMutating || !messageDraft.trim()} onClick={() => void sendMessage()} icon="arrow" loading={isCommunicationMutating}>
                    {isCommunicationMutating ? 'Sending...' : 'Send Message'}
                  </PrimaryButton>
                </div> : <Feedback>This trip is closed. New messages are not available.</Feedback>}
              </> : <EmptyState title="Conversation not available yet" description="Conversation is available once a participant-owned trip record exists." icon="chat" />}
            </div>
          </GlassCard>

          <GlassCard role="region" aria-labelledby="booking-notifications-title">
            <SectionHeader title="Notifications" id="booking-notifications-title" icon="bell" description="Your recent account updates and read status." />
            {isCommunicationLoading ? <SharedLoadingState label="Loading notifications..." /> : notifications.length === 0 ? <EmptyState title="No notifications yet." description="New account notifications will appear here when available." icon="bell" /> : <div className="tb-stack">
              {notifications.map((notification) => (
                <div key={notification.id} className={`tb-booking-notification ${notification.isRead ? 'tb-booking-notification-read' : 'tb-booking-notification-unread'}`}>
                  <div className="tb-safety-panel-heading"><h3>{notification.title}</h3><StatusBadge status={notification.isRead ? 'Read' : 'Unread'} tone={notification.isRead ? 'neutral' : 'info'} /></div>
                  {notification.body && <p className="tb-small">{notification.body}</p>}
                  <div className="tb-booking-notification-footer">
                    <div className="tb-muted tb-small"><time dateTime={notification.createdAt}>{dateTimeValue(notification.createdAt) ?? notification.createdAt}</time>{notification.isRead && notification.readAt && <p>Read {dateTimeValue(notification.readAt) ?? notification.readAt}</p>}</div>
                    {!notification.isRead && <SecondaryButton type="button" disabled={isCommunicationMutating} onClick={() => void markNotificationRead(notification.id)} icon="check">Mark read</SecondaryButton>}
                  </div>
                </div>
              ))}
            </div>}
          </GlassCard>

          {(booking.canCancel || booking.canComplete || showPaymentTests) && <GlassCard role="region" aria-labelledby="booking-actions-title">
            <SectionHeader title="Booking Actions" id="booking-actions-title" icon="document" description="Available actions for the current booking record." />
            <div className="tb-actions">
              {booking.canCancel && cancelAction && <DangerButton type="button" disabled={isMutating} onClick={() => void mutate(cancelAction, 'Unable to cancel this booking.', 'cancel-booking')} loading={mutatingAction === 'cancel-booking'}>{mutatingAction === 'cancel-booking' ? 'Updating...' : 'Cancel Booking'}</DangerButton>}
              {role === 'companion' && booking.canComplete && completeAction && <PrimaryButton type="button" disabled={isMutating} onClick={() => void mutate(completeAction, 'Unable to complete this booking.', 'complete-booking')} icon="check" loading={mutatingAction === 'complete-booking'}>{mutatingAction === 'complete-booking' ? 'Updating...' : 'Complete Booking'}</PrimaryButton>}
            </div>
            {showPaymentTests && <div className="tb-booking-payment-tests tb-stack">
              <h3 className="tb-booking-subheading">Development-only test payment controls</h3>
              <Feedback>No real gateway or charge is involved. These controls must not be interpreted as production payment success.</Feedback>
              <div className="tb-actions">
                {paymentPaidAction && <SecondaryButton type="button" disabled={isMutating} onClick={() => void mutate(paymentPaidAction, 'Unable to mark the development payment as paid.', 'payment-paid')}>Test Payment: Mark Paid</SecondaryButton>}
                {paymentFailedAction && <DangerButton type="button" disabled={isMutating} onClick={() => void mutate(paymentFailedAction, 'Unable to mark the development payment as failed.', 'payment-failed')}>Test Payment: Mark Failed</DangerButton>}
              </div>
            </div>}
          </GlassCard>}
        </div>
      </div>
    </div>
  );
}

/** Presentation only: the journey track reflects the saved booking and trip records. */
function BookingJourney({ booking, trip, isTripLoading }: { booking: BookingView; trip: TripView | null; isTripLoading: boolean }) {
  const cancelled = booking.status.startsWith('cancelled') || trip?.status === 'cancelled';
  const currentStatus = booking.status.startsWith('cancelled') ? booking.status : trip?.status ?? booking.status;
  const currentStep = trip?.status === 'completed' || (!trip && booking.status === 'completed') ? 5
    : trip?.status === 'in_progress' ? 4
      : trip?.status === 'upcoming' ? 3
        : booking.status === 'confirmed' ? 2 : -1;
  const steps = ['Request', 'Matched', 'Booked', 'Upcoming', 'In progress', 'Completed'];
  const descriptions = ['Trip request linked', 'Companion assigned', 'Booking confirmed', 'Before the journey', 'During the journey', 'Journey finished'];

  return <GlassCard tone={cancelled ? 'danger' : 'accent'} className="tb-booking-hero" role="region" aria-labelledby="booking-journey-title">
    <div className="tb-booking-hero-heading">
      <div className="tb-min-zero">
        <p className="tb-app-eyebrow">Current journey status</p>
        <h2 id="booking-journey-title" className="tb-booking-current-status">{formatStatus(currentStatus)}</h2>
        <p className="tb-muted tb-small">{cancelled
          ? 'This journey has a cancellation recorded. Review the booking and trip records below for their individual statuses.'
          : isTripLoading ? 'Loading the latest trip record. The saved booking status is shown below.'
            : trip?.status === 'in_progress' ? 'The trip is in progress. Check-ins, permitted location updates, and conversation are below.'
              : trip?.status === 'completed' ? 'The trip is completed. Your saved conversation, trip details, and available feedback are below.'
                : trip?.status === 'upcoming' ? 'The trip is upcoming. Review the journey details and coordinate with the other participant.'
                  : 'Your booking record is saved. Trip tools become available when a trip record exists.'}</p>
      </div>
      <StatusBadge status={currentStatus} tone={cancelled ? 'danger' : trip?.status === 'in_progress' ? 'info' : undefined}>{formatStatus(currentStatus)}</StatusBadge>
    </div>
    <dl className="tb-details tb-booking-hero-details">
      <div><dt>Booking Reference</dt><dd className="tb-booking-reference">{booking.reference}</dd></div>
      <div><dt>Booking Status</dt><dd><StatusBadge status={booking.status}>{formatStatus(booking.status)}</StatusBadge></dd></div>
      <div><dt>Payment Status</dt><dd><StatusBadge status={booking.paymentStatus}>{formatStatus(booking.paymentStatus)}</StatusBadge></dd></div>
      <div><dt>Amount</dt><dd className="tb-booking-amount">{booking.totalAmount === null ? 'Not supplied' : `${booking.currency} ${booking.totalAmount.toFixed(2)}`}</dd></div>
    </dl>
    <div className="tb-booking-journey-track">
      {cancelled ? <Timeline className="tb-booking-timeline tb-booking-timeline-cancelled" steps={[
        { label: 'Request', status: 'completed', description: 'Trip request linked' },
        { label: 'Matched', status: 'completed', description: 'Companion assigned' },
        { label: 'Cancelled', status: 'current', description: formatStatus(currentStatus) },
      ]} /> : <Timeline className="tb-booking-timeline" steps={steps.map((label, index) => ({
        label,
        status: currentStep === -1 ? (index < 2 ? 'completed' : 'upcoming') : index < currentStep ? 'completed' : index === currentStep ? 'current' : 'upcoming',
        description: currentStep === -1 && index === 2 ? 'Booking status shown above' : descriptions[index],
      }))} />}
    </div>
  </GlassCard>;
}

function LoadingState({ label }: { label: string }) {
  return <GlassCard><SharedLoadingState label={label} /></GlassCard>;
}

function AccessState({ message, href }: { message: string; href?: string }) {
  return <GlassCard><EmptyState title="Booking access" description={message} icon="lock" action={href && <PrimaryButton href={href}>Open sign in</PrimaryButton>} /></GlassCard>;
}
