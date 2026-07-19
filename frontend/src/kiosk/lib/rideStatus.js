// Rider-facing ride status: maps the backend booking lifecycle onto a friendly
// milestone timeline the rider can watch update live on the Track screen. The
// backend statuses (confirmed / driver_assigned / driver_en_route / arrived /
// in_progress / completed / canceled) are engineering words; these are the
// words a rider actually wants to see.

// The five milestones shown as a vertical timeline, in order.
export const TRACK_STEPS = [
  { key: 'booked', label: 'Ride booked' },
  { key: 'matched', label: 'Driver assigned' },
  { key: 'enroute', label: 'On the way to you' },
  { key: 'arrived', label: 'Driver arrived' },
  { key: 'ontrip', label: 'On your trip' },
];

// How many milestones are COMPLETE (green-checked) at a given status. A
// milestone gets its check the instant its own action happens — not when the
// next one begins. So the ride is checked "booked" the moment it's confirmed,
// "driver assigned" the moment a driver accepts, and so on. The last completed
// milestone is the current one (highlighted); everything above it is upcoming.
const STATUS_COMPLETED = {
  confirmed: 1,
  dispatching: 1,
  manual_dispatch_required: 1,
  driver_assigned: 2,
  driver_en_route: 3,
  arrived: 4,
  in_progress: 5,
  completed: 5,
};

export function completedCount(status) {
  return STATUS_COMPLETED[status] ?? 1;
}

// Statuses where nothing more will change — polling can stop.
export function isTerminal(status) {
  return status === 'completed' || status === 'canceled';
}

// The big headline + supporting line at the top of the Track screen.
export function statusHeadline(status) {
  switch (status) {
    case 'confirmed':
    case 'dispatching':
    case 'manual_dispatch_required':
      return { title: 'Finding your driver', sub: "Hang tight — we're matching you with a nearby driver.", tone: 'wait' };
    case 'driver_assigned':
      return { title: 'Driver assigned', sub: 'Your driver will start heading your way shortly.', tone: 'go' };
    case 'driver_en_route':
      return { title: 'Your driver is on the way', sub: 'Make your way to the pickup point.', tone: 'go' };
    case 'arrived':
      return { title: 'Your driver has arrived', sub: 'Head out and meet your driver now.', tone: 'go' };
    case 'in_progress':
      return { title: "You're on your way", sub: 'Sit back and enjoy the ride.', tone: 'go' };
    case 'completed':
      return { title: 'Trip complete', sub: 'Thanks for riding with RoverZoom.', tone: 'done' };
    case 'canceled':
      return { title: 'Ride canceled', sub: 'This booking was canceled.', tone: 'canceled' };
    default:
      return { title: 'Ride booked', sub: '', tone: 'wait' };
  }
}

// Short status pill used in the My Rides list.
export function statusPill(status) {
  switch (status) {
    case 'confirmed':
    case 'dispatching':
    case 'manual_dispatch_required':
      return { label: 'Finding driver', tone: 'wait' };
    case 'driver_assigned':
      return { label: 'Driver assigned', tone: 'go' };
    case 'driver_en_route':
      return { label: 'On the way', tone: 'go' };
    case 'arrived':
      return { label: 'Arrived', tone: 'go' };
    case 'in_progress':
      return { label: 'On your trip', tone: 'go' };
    case 'completed':
      return { label: 'Completed', tone: 'done' };
    case 'canceled':
      return { label: 'Canceled', tone: 'canceled' };
    default:
      return { label: status, tone: 'wait' };
  }
}

// A ride is "active" (worth tracking live) when it's booked but not yet
// finished — i.e. anything that isn't terminal.
export function isTrackable(status) {
  return !isTerminal(status);
}
