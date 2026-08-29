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
