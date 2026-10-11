import {
  getMatchedLanguages,
  getRequiredWeekdays,
  normalizeAvailabilityCalendar,
} from './score-calculator';
import type {
  MatchExplanationComponents,
  MatchExplanationEnvelope,
  MatchStatus,
} from './types';
import type { MatchingCompanion, MatchingTripRequest } from './score-calculator';

interface MatchExplanation {
  summary: string;
  details: string[];
  strengths: string[];
  considerations: string[];
  components: MatchExplanationComponents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function statusValue(value: unknown): MatchStatus | null {
  return value === 'pending' || value === 'accepted' || value === 'rejected' ? value : null;
}

function safeComponents(value: unknown): MatchExplanationComponents | undefined {
  if (!isRecord(value)) return undefined;
  const matchedLanguages = Array.isArray(value.matchedLanguages)
    ? value.matchedLanguages.filter((item): item is string => typeof item === 'string') : [];
  const requiredLanguages = Array.isArray(value.requiredLanguages)
    ? value.requiredLanguages.filter((item): item is string => typeof item === 'string') : [];
  const coveredWeekdays = Array.isArray(value.coveredWeekdays)
    ? value.coveredWeekdays.filter((item): item is string => typeof item === 'string') : [];
  const dateSpan = isRecord(value.dateSpan) && typeof value.dateSpan.departure === 'string' &&
    typeof value.dateSpan.return === 'string'
    ? { departure: value.dateSpan.departure, return: value.dateSpan.return } : null;
  const ratingAverage = typeof value.ratingAverage === 'number' && Number.isFinite(value.ratingAverage)
    ? value.ratingAverage : 0;
  const totalTrips = typeof value.totalTrips === 'number' && Number.isFinite(value.totalTrips)
    ? value.totalTrips : 0;
  const limitations = Array.isArray(value.limitations)
    ? value.limitations.filter((item): item is string => typeof item === 'string') : [];
  return {
    matchedLanguages,
    requiredLanguages,
    coveredWeekdays,
    dateSpan,
    verified: value.verified === true,
    ratingAverage,
    totalTrips,
    limitations,
  };
}

/** Safely normalizes current and legacy JSONB explanation values. */
export function readExplanation(value: unknown, matched = false): MatchExplanationEnvelope {
  if (typeof value === 'string' && value.trim()) {
    return { text: value.trim(), status: matched ? 'accepted' : 'pending' };
  }
  if (isRecord(value)) {
    const text = stringValue(value.text) ?? stringValue(value.summary);
    if (text) {
      return {
        text,
        status: statusValue(value.status) ?? (matched ? 'accepted' : 'pending'),
        ...(safeComponents(value.components) ? { components: safeComponents(value.components) } : {}),
      };
    }
    const details = Array.isArray(value.details)
      ? value.details.filter((item): item is string => typeof item === 'string') : [];
    if (details.length > 0) {
      return {
        text: details.join(' '),
        status: statusValue(value.status) ?? (matched ? 'accepted' : 'pending'),
      };
    }
  }
  return { text: 'Match details are unavailable.', status: matched ? 'accepted' : 'pending' };
}

export function createExplanationEnvelope(
  text: string,
  status: MatchStatus = 'pending',
  components?: MatchExplanationComponents,
): MatchExplanationEnvelope {
  return {
    text: text.trim() || 'Match details are unavailable.',
    status,
    ...(components ? { components } : {}),
  };
}

function normalizedNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

export const explanationGenerator = {
  generateExplanation(tripRequest: MatchingTripRequest, companion: MatchingCompanion, score: number): string {
    return this.formatExplanation(this.generateExplanationComponents(tripRequest, companion, score));
  },

  generateExplanationComponents(
    tripRequest: MatchingTripRequest,
    companion: MatchingCompanion,
    score: number,
  ): MatchExplanation {
    const requiredLanguages = Array.isArray(tripRequest.language_requirements)
      ? tripRequest.language_requirements.filter((item): item is string => typeof item === 'string') : [];
    const matchedLanguages = getMatchedLanguages(requiredLanguages, companion.languages_spoken);
    const requiredWeekdays = getRequiredWeekdays(tripRequest.departure_date, tripRequest.return_date);
    const calendar = normalizeAvailabilityCalendar(companion.availability_calendar);
    const coveredWeekdays = requiredWeekdays.filter((day) => Boolean(calendar?.[day]?.length));
    const ratingAverage = normalizedNumber(companion.rating_average);
    const totalTrips = Math.max(0, normalizedNumber(companion.total_trips));
    const dateSpan = typeof tripRequest.departure_date === 'string' && tripRequest.departure_date
      ? { departure: tripRequest.departure_date, return: tripRequest.return_date ?? tripRequest.departure_date }
      : null;
    const components: MatchExplanationComponents = {
      matchedLanguages,
      requiredLanguages,
      coveredWeekdays,
      dateSpan,
      verified: companion.verification_status === 'verified',
      ratingAverage,
      totalTrips,
      limitations: [
        'Route compatibility cannot be computed from the available companion data.',
        'Assistance capabilities cannot be computed from the available companion data.',
      ],
    };

    const strengths: string[] = [];
    const considerations: string[] = [];
    if (requiredLanguages.length === 0) {
      strengths.push('No specific language requirement was supplied');
    } else if (matchedLanguages.length > 0) {
      strengths.push(`Matches languages: ${matchedLanguages.join(', ')}`);
    } else {
      considerations.push('No required language match');
    }
    if (coveredWeekdays.length === requiredWeekdays.length && requiredWeekdays.length > 0) {
      strengths.push(`Available for ${coveredWeekdays.join(', ')} across ${dateSpan?.departure} to ${dateSpan?.return}`);
    } else {
      considerations.push('Availability does not cover every required weekday');
    }
    if (components.verified) strengths.push('Verified companion');
    else considerations.push('Companion is not verified');
    strengths.push(`Rating ${ratingAverage.toFixed(2)}/5 across ${totalTrips} trips`);
    considerations.push(...components.limitations);

    let summary = 'Poor match - not recommended';
    if (score >= 85) summary = 'Excellent match - highly recommended';
    else if (score >= 70) summary = 'Good match - recommended';
    else if (score >= 50) summary = 'Fair match - may be suitable with some considerations';
    else if (score >= 30) summary = 'Weak match - consider other options';

    return {
      summary,
      details: [
        `Overall compatibility score: ${score}%`,
        `Availability date span: ${dateSpan ? `${dateSpan.departure} to ${dateSpan.return}` : 'unavailable'}`,
        `Covered weekdays: ${coveredWeekdays.length > 0 ? coveredWeekdays.join(', ') : 'none'}`,
        `Verification status: ${String(companion.verification_status)}`,
        `Rating/trips: ${ratingAverage.toFixed(2)}/5, ${totalTrips} trips`,
      ],
      strengths,
      considerations,
      components,
    };
  },

  analyzeLanguageMatch(required: string[], spoken: string[]): {
    match: boolean;
    matchedLanguages: string[];
    missingLanguages: string[];
  } {
    const normalizedRequired = [...new Set(required.map((item) => item.trim().toLowerCase()).filter(Boolean))];
    const matchedLanguages = getMatchedLanguages(normalizedRequired, spoken);
    return {
      match: normalizedRequired.length === 0 || matchedLanguages.length > 0,
      matchedLanguages,
      missingLanguages: normalizedRequired.filter((language) => !matchedLanguages.includes(language)),
    };
  },

  /** Kept as a compatibility read helper; no capability score is inferred. */
  analyzeAssistanceMatch(): { match: false; note: string } {
    return {
      match: false,
      note: 'Assistance capabilities cannot be computed from the available companion data.',
    };
  },

  formatExplanation(explanation: MatchExplanation): string {
    const parts = [explanation.summary, '', 'Details:', ...explanation.details.map((detail) => `  • ${detail}`)];
    if (explanation.strengths.length > 0) {
      parts.push('', 'Strengths:', ...explanation.strengths.map((strength) => `  ✓ ${strength}`));
    }
    if (explanation.considerations.length > 0) {
      parts.push('', 'Considerations:', ...explanation.considerations.map((item) => `  ⚠ ${item}`));
    }
    return parts.join('\n');
  },
};
