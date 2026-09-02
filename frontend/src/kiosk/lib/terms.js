// The age attestation shown immediately before a booking is created.
//
// Versioned deliberately. The recorded booking stores this identifier rather
// than the sentence, so the wording can be revised without making older
// bookings unexplainable — "what exactly did this rider agree to in August?"
// has to stay answerable.
//
// Bump the version whenever the TEXT below changes in substance.
export const TERMS_VERSION = 'age-2026-08-29.v1';

export const AGE_ATTESTATION =
  "By continuing, you confirm you're 18 or over — or the parent or legal guardian of the rider.";

// ---------------------------------------------------------------------------
// SMS consent — separate from everything else, on purpose
// ---------------------------------------------------------------------------
// The A2P 10DLC campaign was rejected under error 30923 for exactly this. The
// old wording was "By booking, you agree to receive text messages…", which
// makes consent a condition of using the service. Carriers require the opposite:
// a distinct checkbox, for SMS only, unchecked by default, that a booking
// completes fine without.
//
// So this is its own version string rather than being folded into
// TERMS_VERSION. The age attestation and the messaging consent are different
// agreements, given at different moments, and a reviewer has to be able to see
// that the second one was optional. Sharing a version would make it impossible
// to say which of the two a given rider actually granted.
export const SMS_CONSENT_VERSION = 'sms-2026-09-02.v1';

// The label on the checkbox itself. Says what will be sent and nothing else —
// the rates and opt-out wording sit beneath it, because a checkbox label that
// runs to four lines does not get read.
export const SMS_CONSENT_LABEL =
  'Text me about this ride — a booking confirmation, and a live tracking link when a driver accepts.';

// Shown under the checkbox. Everything a carrier requires to be disclosed at
// the point of consent.
export const SMS_CONSENT_FINE_PRINT =
  'About 2 messages per booking. Message and data rates may apply. Reply STOP to opt out, HELP for help.';

// The part that makes the consent voluntary, stated plainly rather than left
// to be inferred. A rider who declines still books and can still track.
export const SMS_CONSENT_OPTIONAL_NOTE =
  'Optional. You can book and track your ride without this.';
