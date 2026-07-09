// Short, human-friendly booking codes like RZ-8F3K2.
// Avoids ambiguous chars (0/O, 1/I) for reading aloud in a car.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReference() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `RZ-${code}`;
}

module.exports = { makeReference };
