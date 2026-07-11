import { req } from './api';

export const driverApi = {
  getSchedule: (driverId) => req(`/driver/schedule?driverId=${encodeURIComponent(driverId)}`),
  getAvailableTrips: (driverId) => req(`/driver/available-trips?driverId=${encodeURIComponent(driverId)}`),
  claimBooking: (bookingId, driverId) =>
    req(`/driver/bookings/${bookingId}/claim`, { method: 'POST', body: JSON.stringify({ driverId }) }),
};
